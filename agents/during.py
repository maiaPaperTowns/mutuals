"""Live event: per-participant agents + a central MatchmakerAgent computing pairwise ROI in real time.

Agents (same process, typed messages via ctx.send):
  participant-agents  hosts one ParticipantAgent per checked-in user; relays ProfileUpdate -> matchmaker and
                      pushes MatchesUpdate / ConnectIntent to the user's WebSocket.
  matchmaker-agent    holds live state, scores every pair with calculation.roi_score, emits ranked OpportunityCards.
                      ASI:One-reachable ("who should I meet?").

HTTP/WS: WS /ws/{user_id}, POST /presence, GET /opportunities/{user_id}, POST /connect, POST /connect/respond,
         POST /record/consent, POST /record/start, POST /record/stop, GET /interactions/{interaction_id}
"""

from __future__ import annotations

import asyncio
import json
import logging
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any
from uuid import uuid4

from fastapi import FastAPI, HTTPException, Request, WebSocket, WebSocketDisconnect
from uagents import Agent, Context

import config
from calculation import ScoringContext, roi_score
from common import Outbox, assert_current_user, add_health, install_api_auth, load, make_chat_protocol, new_loop, resolve_chat_user, run, save, wants_end
from integrations import INTERACTIONS, PROFILES, TRANSCRIPTS, send_push, start_recording, stop_recording, store, transcribe, verify_token
from models import (
    ConnectIntent,
    ConnectRequest,
    ConnectResponse,
    Interaction,
    MatchesUpdate,
    OpportunityCard,
    ParticipantLeft,
    ProfileUpdate,
    RecordConsentRequest,
    RecordRequest,
    UserProfile,
    utcnow,
)

log = logging.getLogger("during")
loop = new_loop()

matchmaker = Agent(
    name="matchmaker-agent",
    seed=config.agent_seed("matchmaker"),
    port=config.AGENT_PORTS["matchmaker"],
    mailbox=config.USE_MAILBOX,
    publish_agent_details=True,
    loop=loop,
)
participant_host = Agent(
    name="participant-agents",
    seed=config.agent_seed("participant"),
    port=config.AGENT_PORTS["participant"],
    loop=loop,
)
matchmaker_outbox = Outbox(matchmaker)
participant_outbox = Outbox(participant_host)


def as_json(model: Any) -> dict[str, Any]:
    return json.loads(model.json())


# --- ParticipantAgent (one per user, hosted by participant_host) ----------------------------------------------------

@dataclass
class ParticipantAgent:
    user_id: str
    profile: UserProfile | None = None
    socket: WebSocket | None = None
    pending: list[dict[str, Any]] = field(default_factory=list)

    def build_update(self, payload: dict[str, Any]) -> ProfileUpdate:
        """Stored profile (from pre_event) + live fields from the client."""
        base: dict[str, Any] = {}
        if self.profile:
            base = self.profile.model_dump(include={"name", "role", "goals", "skills", "interests", "offerings", "seniority", "discoverable"})
        live = {k: v for k, v in payload.items() if k in ProfileUpdate.__fields__}
        return ProfileUpdate.parse_obj({**base, **live, "user_id": self.user_id, "timestamp": utcnow()})

    async def deliver(self, event: dict[str, Any]) -> None:
        if self.socket is not None:
            try:
                await self.socket.send_json(event)
                return
            except Exception:
                self.socket = None
        self.pending.append(event)  # flushed on reconnect
        if event["type"] == "connect_request":
            try:
                await send_push(self.user_id, "New connection request", event.get("reason", ""), event)
            except NotImplementedError:
                log.info("push skipped (stub) for %s", self.user_id)


participants: dict[str, ParticipantAgent] = {}


def get_participant(user_id: str) -> ParticipantAgent:
    if user_id not in participants:
        participants[user_id] = ParticipantAgent(user_id, load(UserProfile, PROFILES, user_id))
    return participants[user_id]


@participant_host.on_message(MatchesUpdate)
async def on_matches(ctx: Context, sender: str, msg: MatchesUpdate) -> None:
    await get_participant(msg.user_id).deliver({"type": "matches", "cards": [as_json(c) for c in msg.cards]})


@participant_host.on_message(ConnectIntent)
async def on_connect_intent(ctx: Context, sender: str, msg: ConnectIntent) -> None:
    ctx.logger.info(f"connect request {msg.from_user_id} -> {msg.target_id}")
    await get_participant(msg.target_id).deliver({"type": "connect_request", **as_json(msg)})


# --- MatchmakerAgent -------------------------------------------------------------------------------------------------

live: dict[str, ProfileUpdate] = {}
last_seen: dict[str, datetime] = {}
sent_signatures: dict[str, tuple[tuple[str, float], ...]] = {}


@matchmaker.on_event("startup")
async def restore_presence(ctx: Context) -> None:
    try:
        rows = await asyncio.to_thread(store.list_presence)
        now = utcnow()
        for data in rows:
            update = ProfileUpdate.model_validate(data)
            if (now - update.timestamp).total_seconds() > config.STALE_TIMEOUT_S:
                await asyncio.to_thread(store.delete_presence, update.user_id)
                continue
            live[update.user_id] = update
            last_seen[update.user_id] = update.timestamp
        ctx.logger.info("restored %d active participant presence records", len(live))
    except Exception:
        ctx.logger.exception("could not restore active participant presence")


def sync_presence(rows: list[dict[str, Any]] | None = None) -> None:
    active_ids = {row["user_id"] for row in (rows if rows is not None else store.list_presence())}
    for user_id in set(live) - active_ids:
        remove_participant(user_id)


def compute_cards(user_id: str, presence_rows: list[dict[str, Any]] | None = None) -> list[OpportunityCard]:
    sync_presence(presence_rows)
    me = live.get(user_id)
    if me is None:
        return []
    now, subject = utcnow(), me.to_subject()
    cards = []
    for other in live.values():
        if other.user_id == user_id or not other.discoverable:
            continue
        result = roi_score(subject, other.to_subject(), ScoringContext(now=now))
        if result.score >= config.MATCH_THRESHOLD:
            cards.append(OpportunityCard(
                target_id=other.user_id, target_name=other.name, role=other.role, location=other.location,
                roi_score=result.score, reason_for_connection=result.reason, breakdown=result.breakdown,
            ))
    return sorted(cards, key=lambda c: c.roi_score, reverse=True)[: config.MAX_CARDS]


@matchmaker.on_message(ProfileUpdate)
async def on_profile_update(ctx: Context, sender: str, msg: ProfileUpdate) -> None:
    try:
        await asyncio.to_thread(store.put_presence, msg.user_id, as_json(msg))
    except Exception:
        ctx.logger.exception("could not persist presence for %s", msg.user_id)
        return
    live[msg.user_id] = msg
    last_seen[msg.user_id] = utcnow()


def remove_participant(user_id: str) -> None:
    live.pop(user_id, None)
    last_seen.pop(user_id, None)
    sent_signatures.pop(user_id, None)
    participant = participants.pop(user_id, None)
    if participant is not None:
        participant.pending.clear()
        participant.profile = None
        participant.socket = None


@matchmaker.on_message(ParticipantLeft)
async def on_left(ctx: Context, sender: str, msg: ParticipantLeft) -> None:
    try:
        await asyncio.to_thread(store.delete_presence, msg.user_id)
    except Exception:
        ctx.logger.exception("could not remove persisted presence for %s", msg.user_id)
    remove_participant(msg.user_id)


@matchmaker.on_interval(period=config.MATCH_INTERVAL_S)
async def rematch(ctx: Context) -> None:
    try:
        rows = await asyncio.to_thread(store.list_presence)
    except Exception:
        ctx.logger.exception("could not synchronize active participant presence")
        return
    sync_presence(rows)
    now = utcnow()
    for user_id in [u for u, seen in last_seen.items() if (now - seen).total_seconds() > config.STALE_TIMEOUT_S]:
        ctx.logger.info(f"removing stale participant {user_id}")
        try:
            await asyncio.to_thread(store.delete_presence, user_id)
        except Exception:
            ctx.logger.exception("could not expire persisted presence for %s", user_id)
            continue
        remove_participant(user_id)
    for user_id in list(live):
        cards = compute_cards(user_id, rows)
        signature = tuple((c.target_id, c.roi_score) for c in cards)
        if signature != sent_signatures.get(user_id):
            sent_signatures[user_id] = signature
            await ctx.send(participant_host.address, MatchesUpdate(user_id=user_id, cards=cards, generated_at=now))


async def answer(ctx: Context, sender: str, text: str) -> tuple[str, bool]:
    if wants_end(text):
        return "Enjoy the event!", True
    user_id, reply = await resolve_chat_user(ctx, sender, text)
    if reply:
        return reply, False
    cards = compute_cards(user_id)
    if user_id not in live:
        return "You're not checked in yet. Open the app at the event so I can see your live status.", False
    if not cards:
        return "No high-ROI matches right now. I'll keep looking as people arrive.", False
    lines = [f"{i}. {c.target_name or c.target_id} ({c.role}, {c.location.zone or 'nearby'}) ROI {c.roi_score:.0f}: {c.reason_for_connection}"
             for i, c in enumerate(cards, 1)]
    return "Your best connections right now:\n" + "\n".join(lines), False


matchmaker.include(make_chat_protocol(answer), publish_manifest=True)
add_health(matchmaker)


# --- Connections & recording -----------------------------------------------------------------------------------------

def get_interaction(interaction_id: str, user_id: str) -> Interaction:
    interaction = load(Interaction, INTERACTIONS, interaction_id)
    if interaction is None:
        raise HTTPException(404, "Unknown interaction")
    if user_id not in interaction.parties():
        raise HTTPException(403, "Not a party to this interaction")
    return interaction


def create_connection(user_id: str, target_id: str) -> Interaction:
    sync_presence()
    me, target = live.get(user_id), live.get(target_id)
    if me is None:
        raise HTTPException(409, "Check in (send a presence update) before connecting")
    if target is None or not target.discoverable:
        raise HTTPException(404, "Target is not discoverable right now")
    result = roi_score(me.to_subject(), target.to_subject(), ScoringContext(now=utcnow()))
    interaction = Interaction(
        interaction_id=uuid4().hex, user_id=user_id, target_id=target_id,
        roi_score_at_match=result.score, reason=result.reason,
    )
    save(INTERACTIONS, interaction.interaction_id, interaction)
    matchmaker_outbox.put(participant_host.address, ConnectIntent(
        interaction_id=interaction.interaction_id, from_user_id=user_id, from_name=me.name,
        target_id=target_id, roi_score=result.score, reason=result.reason,
    ))
    return interaction


async def respond_connection(req: ConnectResponse) -> Interaction:
    interaction = get_interaction(req.interaction_id, req.user_id)
    if req.user_id != interaction.target_id:
        raise HTTPException(403, "Only the target can respond")
    interaction.status = "accepted" if req.accept else "declined"
    save(INTERACTIONS, interaction.interaction_id, interaction)
    await get_participant(interaction.user_id).deliver({"type": "connect_response", **interaction.model_dump(mode="json")})
    return interaction


app = FastAPI(title="During-Event API")
install_api_auth(app)


@app.websocket("/ws/{user_id}")
async def participant_socket(ws: WebSocket, user_id: str) -> None:
    """Client -> server: {"type": "update", location, availability, discoverable, ...} | {"type": "connect", target_id}
    | {"type": "respond", interaction_id, accept} | {"type": "leave"}.
    Server -> client: matches | connect_request | connect_response | ack | error.
    """
    auth = ws.headers.get("authorization", "")
    scheme, _, token = auth.partition(" ")
    if scheme.lower() != "bearer" or not token:
        token = next((p.strip()[7:] for p in ws.headers.get("sec-websocket-protocol", "").split(",") if p.strip().startswith("bearer.")), "")
    if not token:
        await ws.close(code=4401)
        return
    try:
        subject = await verify_token(token.strip())
        authenticated_user_id = await asyncio.to_thread(store.resolve_identity, subject)
    except Exception:
        await ws.close(code=4401)
        return
    if authenticated_user_id != user_id:
        await ws.close(code=4403)
        return
    await ws.accept()
    participant = get_participant(user_id)
    participant.socket = ws
    for event in participant.pending:
        await ws.send_json(event)
    participant.pending.clear()
    try:
        while True:
            raw = await ws.receive_text()
            try:
                data = json.loads(raw)
                kind = data.get("type") if isinstance(data, dict) else None
                if kind == "update":
                    participant_outbox.put(matchmaker.address, participant.build_update(data))
                    await ws.send_json({"type": "ack"})
                elif kind == "connect":
                    interaction = create_connection(user_id, data["target_id"])
                    await ws.send_json({"type": "ack", "interaction": interaction.model_dump(mode="json")})
                elif kind == "respond":
                    await respond_connection(ConnectResponse(interaction_id=data["interaction_id"], user_id=user_id, accept=data["accept"]))
                    await ws.send_json({"type": "ack"})
                elif kind == "leave":
                    participant_outbox.put(matchmaker.address, ParticipantLeft(user_id=user_id))
                    await ws.send_json({"type": "ack"})
                else:
                    await ws.send_json({"type": "error", "detail": f"unknown type {kind!r}"})
            except HTTPException as exc:
                await ws.send_json({"type": "error", "detail": exc.detail})
            except Exception as exc:
                await ws.send_json({"type": "error", "detail": f"{type(exc).__name__}: {exc}"})
    except WebSocketDisconnect:
        pass
    finally:
        participant.socket = None  # stays matchable until STALE_TIMEOUT_S without updates


@app.post("/presence")
async def presence(payload: dict[str, Any], request: Request) -> dict[str, Any]:
    """HTTP alternative to a WS "update" (same fields plus user_id)."""
    if "user_id" not in payload:
        raise HTTPException(422, "user_id required")
    assert_current_user(request, payload["user_id"])
    update = get_participant(payload["user_id"]).build_update(payload)
    participant_outbox.put(matchmaker.address, update)
    return as_json(update)


@app.get("/opportunities/{user_id}")
async def opportunities(user_id: str, request: Request) -> list[dict[str, Any]]:
    assert_current_user(request, user_id)
    cards = compute_cards(user_id)
    if user_id not in live:
        raise HTTPException(404, "User is not checked in")
    return [as_json(c) for c in cards]


@app.post("/connect", response_model=Interaction)
async def connect(req: ConnectRequest, request: Request) -> Interaction:
    assert_current_user(request, req.user_id)
    return create_connection(req.user_id, req.target_id)


@app.post("/connect/respond", response_model=Interaction)
async def connect_respond(req: ConnectResponse, request: Request) -> Interaction:
    assert_current_user(request, req.user_id)
    return await respond_connection(req)


@app.get("/interactions/{interaction_id}", response_model=Interaction)
async def interaction_detail(interaction_id: str, user_id: str, request: Request) -> Interaction:
    assert_current_user(request, user_id)
    return get_interaction(interaction_id, user_id)


@app.post("/record/consent", response_model=Interaction)
async def record_consent(req: RecordConsentRequest, request: Request) -> Interaction:
    assert_current_user(request, req.user_id)
    interaction = get_interaction(req.interaction_id, req.user_id)
    interaction.recording_consent[req.user_id] = req.consent
    if not req.consent:
        if interaction.recording_active:  # revoking consent stops capture and discards audio
            try:
                await stop_recording(interaction.interaction_id)
            except NotImplementedError:
                pass
        store.delete(TRANSCRIPTS, interaction.interaction_id)
        interaction.recording_active = False
        interaction.audio_ref = None
        interaction.transcript_ref = None
        if interaction.status == "recorded":
            interaction.status = "accepted"
    save(INTERACTIONS, interaction.interaction_id, interaction)
    return interaction


@app.post("/record/start", response_model=Interaction)
async def record_start(req: RecordRequest, request: Request) -> Interaction:
    assert_current_user(request, req.user_id)
    interaction = get_interaction(req.interaction_id, req.user_id)
    if not all(interaction.recording_consent.get(u) for u in interaction.parties()):
        raise HTTPException(403, "Both participants must consent before recording")
    if interaction.recording_active:
        raise HTTPException(409, "Already recording")
    try:
        await start_recording(interaction.interaction_id)
    except NotImplementedError as exc:
        raise HTTPException(501, str(exc))
    interaction.recording_active = True
    save(INTERACTIONS, interaction.interaction_id, interaction)
    return interaction


@app.post("/record/stop", response_model=Interaction)
async def record_stop(req: RecordRequest, request: Request) -> Interaction:
    assert_current_user(request, req.user_id)
    interaction = get_interaction(req.interaction_id, req.user_id)
    if not interaction.recording_active:
        raise HTTPException(409, "Not recording")
    try:
        interaction.audio_ref = await stop_recording(interaction.interaction_id)
        text = await transcribe(interaction.audio_ref)
    except NotImplementedError as exc:
        raise HTTPException(501, str(exc))
    store.put(TRANSCRIPTS, interaction.interaction_id, {"interaction_id": interaction.interaction_id, "text": text})
    interaction.transcript_ref = interaction.interaction_id
    interaction.recording_active = False
    interaction.status = "recorded"
    save(INTERACTIONS, interaction.interaction_id, interaction)
    return interaction


@app.get("/health")
async def health() -> dict[str, Any]:
    return {"status": "ok", "matchmaker": matchmaker.address, "live_participants": len(live)}


if __name__ == "__main__":
    run(loop, [matchmaker, participant_host], app, config.HTTP_PORTS["during"])
