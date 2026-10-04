"""Post-event follow-up: two representative agents negotiate a NextStepPlan per interacting pair.

Agents (same process, typed messages via ctx.send):
  followup-agent   coordinator; starts negotiations, drafts messages, stores plans. ASI:One-reachable.
  followup-rep-a   speaks for interaction.user_a (initiator)  } bounded alternating-offer exchange,
  followup-rep-b   speaks for interaction.user_b (target)     } max config.MAX_NEGOTIATION_TURNS turns

Protocol: each turn a side proposes its most preferred channel not yet rejected. The other side accepts if the
channel is in its own allowed list, otherwise rejects and counter-proposes. Nothing is agreed unless both sides
allow it; if turns run out, the least-invasive mutually allowed channel is used, else NONE.

HTTP: POST /preferences, POST /followups/run, GET /followups/{user_id}, POST /followups/{plan_id}/approve,
      POST /followups/{plan_id}/outcome, GET /roi-history/{user_id}
"""

from __future__ import annotations

import json
import logging
from typing import Any

from fastapi import FastAPI, HTTPException, Request
from uagents import Agent, Context

import config
from common import Outbox, assert_current_user, add_health, install_api_auth, llm_complete, load, load_all, make_chat_protocol, new_loop, parse_json_object, resolve_chat_user, run, save, wants_end
from integrations import INTERACTIONS, PLANS, PROFILES, ROI_HISTORY, load_transcript, send_outreach
from models import (
    CHANNEL_INVASIVENESS,
    ApproveRequest,
    FollowUpChannel,
    FollowUpPreferences,
    Interaction,
    NegotiationResult,
    NegotiationStart,
    NegotiationTurn,
    NextStepPlan,
    OutcomeRequest,
    PreferencesRequest,
    RoiHistoryEntry,
    UserProfile,
)

log = logging.getLogger("post_event")
loop = new_loop()

followup = Agent(
    name="followup-agent",
    seed=config.agent_seed("followup"),
    port=config.AGENT_PORTS["followup"],
    mailbox=config.USE_MAILBOX,
    publish_agent_details=True,
    loop=loop,
)
rep_a = Agent(name="followup-rep-a", seed=config.agent_seed("rep_a"), port=config.AGENT_PORTS["rep_a"], loop=loop)
rep_b = Agent(name="followup-rep-b", seed=config.agent_seed("rep_b"), port=config.AGENT_PORTS["rep_b"], loop=loop)
outbox = Outbox(followup)

CHANNEL_TIMING = {
    FollowUpChannel.NONE: "No follow-up",
    FollowUpChannel.LINKEDIN: "Within 24 hours, while the conversation is fresh",
    FollowUpChannel.EMAIL: "Within 48 hours",
    FollowUpChannel.INSTAGRAM: "Within 24 hours",
    FollowUpChannel.INTERVIEW: "Propose 2-3 slots within the next 5 business days",
}


def pair_key(user_a: str, user_b: str) -> str:
    return "__".join(sorted((user_a, user_b)))


def load_profile(user_id: str) -> UserProfile:
    return load(UserProfile, PROFILES, user_id) or UserProfile(user_id=user_id)


# --- Negotiation rules (pure) ---------------------------------------------------------------------------------------

def next_proposal(prefs: FollowUpPreferences, rejected: set[str]) -> FollowUpChannel | None:
    return next((c for c in prefs.allowed_channels if c != FollowUpChannel.NONE and c.value not in rejected), None)


def least_invasive_mutual(a: FollowUpPreferences, b: FollowUpPreferences) -> FollowUpChannel:
    mutual = (set(a.allowed_channels) & set(b.allowed_channels)) - {FollowUpChannel.NONE}
    return min(mutual, key=CHANNEL_INVASIVENESS.__getitem__) if mutual else FollowUpChannel.NONE


# --- Representative agents -------------------------------------------------------------------------------------------

def make_representative(agent: Agent, side: str) -> None:
    def my_user(msg: NegotiationTurn | NegotiationStart) -> str:
        return msg.user_a if side == "a" else msg.user_b

    def peer_address() -> str:
        return rep_b.address if side == "a" else rep_a.address

    async def take_turn(ctx: Context, msg: NegotiationTurn) -> None:
        prefs = load_profile(my_user(msg)).followup_prefs
        log_lines, rejected = list(msg.log), set(msg.rejected)
        ids = dict(session_id=msg.session_id, interaction_id=msg.interaction_id, user_a=msg.user_a, user_b=msg.user_b)

        if msg.proposal:
            if FollowUpChannel(msg.proposal) in prefs.allowed_channels:
                log_lines.append(f"turn {msg.turn}: {side} accepts {msg.proposal}")
                await ctx.send(followup.address, NegotiationResult(**ids, agreed=True, channels=[msg.proposal], log=log_lines))
                return
            rejected.add(msg.proposal)
            log_lines.append(f"turn {msg.turn}: {side} declines {msg.proposal}")

        counter = next_proposal(prefs, rejected)
        if counter is None or msg.turn >= msg.max_turns:
            log_lines.append(f"turn {msg.turn}: no agreement")
            await ctx.send(followup.address, NegotiationResult(**ids, agreed=False, channels=[], log=log_lines))
            return
        log_lines.append(f"turn {msg.turn + 1}: {side} proposes {counter.value}")
        await ctx.send(peer_address(), NegotiationTurn(
            **ids, turn=msg.turn + 1, max_turns=msg.max_turns, from_side=side,
            proposal=counter.value, rejected=sorted(rejected), log=log_lines,
        ))

    @agent.on_message(NegotiationStart)
    async def on_start(ctx: Context, sender: str, msg: NegotiationStart) -> None:
        ctx.logger.info(f"negotiation {msg.session_id} started for {my_user(msg)}")
        await take_turn(ctx, NegotiationTurn(
            session_id=msg.session_id, interaction_id=msg.interaction_id, user_a=msg.user_a, user_b=msg.user_b,
            turn=0, max_turns=msg.max_turns, from_side="",
        ))

    @agent.on_message(NegotiationTurn)
    async def on_turn(ctx: Context, sender: str, msg: NegotiationTurn) -> None:
        await take_turn(ctx, msg)


make_representative(rep_a, "a")
make_representative(rep_b, "b")


# --- Coordinator ------------------------------------------------------------------------------------------------------

in_flight: set[str] = set()

DRAFT_PROMPT = """You write short, warm, specific follow-up messages after a campus networking conversation.
Given both profiles, the transcript (may be empty) and the agreed channel, reply with ONLY JSON:
{"draft_a": "<message user_a sends to user_b>", "draft_b": "<message user_b sends to user_a>",
 "rationale": "<one line: why this channel and next step>"}
Match the channel's tone (LinkedIn: brief; email: subject line + body; interview_scheduling: propose times).
Max 90 words per draft. Do not invent facts beyond the inputs."""


async def draft_messages(a: UserProfile, b: UserProfile, interaction: Interaction, channel: FollowUpChannel) -> dict[str, str]:
    if channel == FollowUpChannel.NONE:
        return {"draft_a": "", "draft_b": "", "rationale": "No mutually acceptable channel, so no follow-up is proposed."}
    payload = {
        "channel": channel.value,
        "user_a": a.model_dump(include={"name", "role", "headline", "goals", "offerings"}),
        "user_b": b.model_dump(include={"name", "role", "headline", "goals", "offerings"}),
        "match_reason": interaction.reason,
        "transcript": (await load_transcript(interaction.transcript_ref))[:6000],
    }
    try:
        return parse_json_object(await llm_complete(DRAFT_PROMPT, json.dumps(payload)))
    except Exception as exc:
        log.warning("LLM drafting failed, using templates: %s", exc)
        return {
            "draft_a": f"Hi {b.name or 'there'}, great meeting you at the event! I'd love to stay in touch.",
            "draft_b": f"Hi {a.name or 'there'}, great meeting you at the event! Let's keep in touch.",
            "rationale": f"Both sides allow {channel.value}; {interaction.reason}.",
        }


def start_negotiation(interaction: Interaction) -> str | None:
    key = pair_key(interaction.user_id, interaction.target_id)
    if key in in_flight or load(NextStepPlan, PLANS, key):
        return None
    in_flight.add(key)
    outbox.put(rep_a.address, NegotiationStart(
        session_id=key, interaction_id=interaction.interaction_id,
        user_a=interaction.user_id, user_b=interaction.target_id, max_turns=config.MAX_NEGOTIATION_TURNS,
    ))
    return key


def run_pending() -> list[str]:
    return [k for i in load_all(Interaction, INTERACTIONS) if i.status != "declined" and (k := start_negotiation(i))]


def as_text(value: Any) -> str:
    """LLM fields may come back as null or as {"subject": ..., "body": ...}; flatten to plain text."""
    if value is None:
        return ""
    if isinstance(value, dict):
        return "\n\n".join(f"{k.title()}: {v}" if k.lower() == "subject" else str(v) for k, v in value.items())
    return str(value)


@followup.on_message(NegotiationResult)
async def on_result(ctx: Context, sender: str, msg: NegotiationResult) -> None:
    try:
        await build_plan(ctx, msg)
    except Exception:
        ctx.logger.exception(f"failed to build plan {msg.session_id}")
    finally:
        in_flight.discard(msg.session_id)


async def build_plan(ctx: Context, msg: NegotiationResult) -> None:
    a, b = load_profile(msg.user_a), load_profile(msg.user_b)
    interaction = load(Interaction, INTERACTIONS, msg.interaction_id)
    if interaction is None:
        return
    log_lines = list(msg.log)
    if msg.agreed:
        channels = [FollowUpChannel(c) for c in msg.channels]
    else:
        channels = [least_invasive_mutual(a.followup_prefs, b.followup_prefs)]
        log_lines.append(f"fallback: least invasive mutually allowed channel = {channels[0].value}")
    drafts = await draft_messages(a, b, interaction, channels[0])
    plan = NextStepPlan(
        plan_id=msg.session_id, interaction_id=msg.interaction_id, user_a=msg.user_a, user_b=msg.user_b,
        channels=channels, agreed=msg.agreed,
        drafts={msg.user_a: as_text(drafts.get("draft_a")), msg.user_b: as_text(drafts.get("draft_b"))},
        suggested_timing=CHANNEL_TIMING.get(channels[0], "Within a week"),
        rationale=as_text(drafts.get("rationale")), negotiation_log=log_lines,
    )
    save(PLANS, plan.plan_id, plan)
    for user_id, target_id in ((msg.user_a, msg.user_b), (msg.user_b, msg.user_a)):
        entry_id = f"{user_id}__{msg.interaction_id}"
        if not load(RoiHistoryEntry, ROI_HISTORY, entry_id):
            save(ROI_HISTORY, entry_id, RoiHistoryEntry(
                entry_id=entry_id, user_id=user_id, target_id=target_id, interaction_id=msg.interaction_id,
                plan_id=plan.plan_id, roi_score_at_match=interaction.roi_score_at_match,
            ))
    ctx.logger.info(f"plan {plan.plan_id}: {[c.value for c in channels]} (agreed={msg.agreed})")


if config.FOLLOWUP_SCAN_S > 0:
    @followup.on_interval(period=config.FOLLOWUP_SCAN_S)
    async def scan(ctx: Context) -> None:
        if started := run_pending():
            ctx.logger.info(f"started negotiations: {started}")


def plans_for(user_id: str) -> list[NextStepPlan]:
    return [p for p in load_all(NextStepPlan, PLANS) if user_id in (p.user_a, p.user_b)]


def user_view(plan: NextStepPlan, user_id: str) -> dict[str, Any]:
    peer = plan.user_b if user_id == plan.user_a else plan.user_a
    return {
        "plan_id": plan.plan_id, "peer_id": peer, "channels": [c.value for c in plan.channels], "agreed": plan.agreed,
        "your_draft": plan.drafts.get(user_id, ""), "suggested_timing": plan.suggested_timing,
        "rationale": plan.rationale, "approved": plan.approvals.get(user_id, False),
        "send_status": plan.send_status.get(user_id),
    }


async def answer(ctx: Context, sender: str, text: str) -> tuple[str, bool]:
    if wants_end(text):
        return "Good luck with your follow-ups!", True
    user_id, reply = await resolve_chat_user(ctx, sender, text)
    if reply:
        return reply, False
    plans = plans_for(user_id)
    if not plans:
        return "No follow-up plans yet. They are generated after the event from your logged interactions.", False
    lines = [f"- {v['peer_id']}: {', '.join(v['channels'])} ({v['suggested_timing']}). {v['rationale']}\n  Draft: {v['your_draft']}"
             for v in (user_view(p, user_id) for p in plans)]
    return "Your follow-ups (approve them in the app before anything is sent):\n" + "\n".join(lines), False


followup.include(make_chat_protocol(answer), publish_manifest=True)
add_health(followup)


# --- HTTP API ----------------------------------------------------------------------------------------------------------

app = FastAPI(title="Post-Event API")
install_api_auth(app)


@app.post("/preferences", response_model=FollowUpPreferences)
async def set_preferences(req: PreferencesRequest, request: Request) -> FollowUpPreferences:
    assert_current_user(request, req.user_id)
    profile = load_profile(req.user_id)
    profile.followup_prefs = FollowUpPreferences(allowed_channels=req.allowed_channels, handles=req.handles, notes=req.notes)
    save(PROFILES, profile.user_id, profile)
    return profile.followup_prefs


@app.post("/followups/run")
async def run_followups() -> dict[str, list[str]]:
    """Call at event end (or enable FOLLOWUP_SCAN_S) to negotiate every interaction without a plan."""
    return {"started": run_pending()}


@app.get("/followups/{user_id}")
async def get_followups(user_id: str, request: Request) -> list[dict[str, Any]]:
    assert_current_user(request, user_id)
    return [user_view(p, user_id) for p in plans_for(user_id)]


def get_plan(plan_id: str, user_id: str) -> NextStepPlan:
    plan = load(NextStepPlan, PLANS, plan_id)
    if plan is None:
        raise HTTPException(404, "Unknown plan")
    if user_id not in (plan.user_a, plan.user_b):
        raise HTTPException(403, "Not your plan")
    return plan


@app.post("/followups/{plan_id}/approve")
async def approve(plan_id: str, req: ApproveRequest, request: Request) -> dict[str, Any]:
    """The only path that sends anything, and only the approving user's own draft."""
    assert_current_user(request, req.user_id)
    plan = get_plan(plan_id, req.user_id)
    plan.approvals[req.user_id] = True
    channel = plan.channels[0]
    peer = plan.user_b if req.user_id == plan.user_a else plan.user_a
    if channel == FollowUpChannel.NONE:
        plan.send_status[req.user_id] = "nothing to send"
    else:
        try:
            delivery_id = await send_outreach(channel.value, req.user_id, peer, plan.drafts[req.user_id])
            plan.send_status[req.user_id] = f"sent:{delivery_id}"
        except NotImplementedError:
            plan.send_status[req.user_id] = "approved; sending not implemented (stub)"
    save(PLANS, plan.plan_id, plan)
    return user_view(plan, req.user_id)


@app.post("/followups/{plan_id}/outcome", response_model=RoiHistoryEntry)
async def record_outcome(plan_id: str, req: OutcomeRequest, request: Request) -> RoiHistoryEntry:
    assert_current_user(request, req.user_id)
    plan = get_plan(plan_id, req.user_id)
    entry_id = f"{req.user_id}__{plan.interaction_id}"
    entry = load(RoiHistoryEntry, ROI_HISTORY, entry_id)
    if entry is None:
        raise HTTPException(404, "No ROI history entry for this plan")
    entry.outcome = req.outcome
    save(ROI_HISTORY, entry_id, entry)
    return entry


@app.get("/roi-history/{user_id}", response_model=list[RoiHistoryEntry])
async def roi_history(user_id: str, request: Request) -> list[RoiHistoryEntry]:
    assert_current_user(request, user_id)
    return [e for e in load_all(RoiHistoryEntry, ROI_HISTORY) if e.user_id == user_id]


@app.get("/health")
async def health() -> dict[str, Any]:
    return {"status": "ok", "followup_agent": followup.address, "in_flight": sorted(in_flight)}


if __name__ == "__main__":
    run(loop, [followup, rep_a, rep_b], app, config.HTTP_PORTS["post_event"])
