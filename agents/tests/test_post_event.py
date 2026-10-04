import asyncio
import json

import pytest
from auth_helpers import TestClient

import post_event as pe
from common import load, save
from conftest import FakeCtx
from integrations import INTERACTIONS, PLANS, PROFILES, ROI_HISTORY, TRANSCRIPTS, store
from models import (
    FollowUpChannel as C,
    FollowUpPreferences,
    Interaction,
    NegotiationResult,
    NegotiationStart,
    NegotiationTurn,
    NextStepPlan,
    RoiHistoryEntry,
    UserProfile,
)

client = TestClient(pe.app)


@pytest.fixture(autouse=True)
def reset_state():
    pe.in_flight.clear()
    while not pe.outbox._queue.empty():
        pe.outbox._queue.get_nowait()


@pytest.fixture
def fake_llm(monkeypatch):
    prompts = []

    async def llm(system, user, max_tokens=1024):
        prompts.append(json.loads(user))
        return json.dumps({"draft_a": "Hi Bob, thanks for the chat!", "draft_b": "Hi Alice, great meeting you!", "rationale": "Both like email."})

    monkeypatch.setattr(pe, "llm_complete", llm)
    return prompts


def set_prefs(user_id, *channels):
    profile = load(UserProfile, PROFILES, user_id) or UserProfile(user_id=user_id)
    profile.followup_prefs = FollowUpPreferences(allowed_channels=list(channels))
    save(PROFILES, user_id, profile)


def add_interaction(iid="i-ab", a="alice", b="bob", status="accepted", **extra):
    record = Interaction(interaction_id=iid, user_id=a, target_id=b, status=status, roi_score_at_match=70, reason="Strong goal match", **extra)
    save(INTERACTIONS, iid, record)
    return record


def negotiate(user_a, user_b, max_turns=4, iid="i-ab"):
    """Relay messages between the agents exactly as uagents would. Returns (result, turns)."""
    agents = {pe.rep_a.address: pe.rep_a, pe.rep_b.address: pe.rep_b}
    ctx = FakeCtx()
    start = NegotiationStart(session_id=pe.pair_key(user_a, user_b), interaction_id=iid, user_a=user_a, user_b=user_b, max_turns=max_turns)
    queue, turns = [(pe.rep_a.address, start)], []
    while queue:
        destination, msg = queue.pop(0)
        if isinstance(msg, NegotiationResult):
            assert destination == pe.followup.address
            return msg, turns
        assert destination in agents
        turns.append(msg)
        ctx.sent.clear()
        handler = rep_handlers(agents[destination])[type(msg).__name__]
        asyncio.run(handler(ctx, "agent1peer", msg))
        queue.extend(ctx.sent)
    raise AssertionError("negotiation never finished")


def rep_handlers(agent):
    funcs = {**agent._protocol._signed_message_handlers, **agent._protocol._unsigned_message_handlers}.values()
    by_name = {f.__name__: f for f in funcs}
    return {"NegotiationStart": by_name["on_start"], "NegotiationTurn": by_name["on_turn"]}


# --- pure rules -------------------------------------------------------------------------------------------------

def test_next_proposal_skips_rejected_and_none():
    prefs = FollowUpPreferences(allowed_channels=[C.NONE, C.EMAIL, C.LINKEDIN])
    assert pe.next_proposal(prefs, set()) == C.EMAIL
    assert pe.next_proposal(prefs, {"email"}) == C.LINKEDIN
    assert pe.next_proposal(prefs, {"email", "linkedin"}) is None


def test_least_invasive_mutual():
    a = FollowUpPreferences(allowed_channels=[C.INTERVIEW, C.EMAIL, C.LINKEDIN])
    b = FollowUpPreferences(allowed_channels=[C.EMAIL, C.LINKEDIN])
    assert pe.least_invasive_mutual(a, b) == C.LINKEDIN
    assert pe.least_invasive_mutual(a, FollowUpPreferences(allowed_channels=[C.INSTAGRAM])) == C.NONE


def test_pair_key_is_order_independent():
    assert pe.pair_key("bob", "alice") == pe.pair_key("alice", "bob") == "alice__bob"


# --- agent-to-agent negotiation ------------------------------------------------------------------------------------

def test_immediate_agreement():
    set_prefs("alice", C.EMAIL, C.LINKEDIN)
    set_prefs("bob", C.LINKEDIN, C.EMAIL)
    result, turns = negotiate("alice", "bob")
    assert result.agreed and result.channels == ["email"] and len(turns) == 2


def test_multi_turn_agreement_with_fake_data(seeded):
    result, _ = negotiate("alice", "bob")  # alice: instagram>email>linkedin, bob: interview>linkedin>email
    assert result.agreed and result.channels == ["email"]
    assert result.log == ["turn 1: a proposes instagram", "turn 1: b declines instagram", "turn 2: b proposes interview_scheduling",
                          "turn 2: a declines interview_scheduling", "turn 3: a proposes email", "turn 3: b accepts email"]


def test_turn_limit_ends_without_agreement():
    set_prefs("alice", C.INSTAGRAM, C.EMAIL, C.LINKEDIN)
    set_prefs("bob", C.INTERVIEW, C.LINKEDIN)
    result, turns = negotiate("alice", "bob", max_turns=2)
    assert not result.agreed and sum(isinstance(t, NegotiationTurn) and t.proposal is not None for t in turns) <= 2


def test_disjoint_preferences(seeded):
    result, _ = negotiate("alice", "dave")  # dave only allows interview scheduling
    assert not result.agreed and result.channels == []


# --- coordinator --------------------------------------------------------------------------------------------------------

def result_msg(agreed, channels, a="alice", b="bob", iid="i-ab"):
    return NegotiationResult(session_id=pe.pair_key(a, b), interaction_id=iid, user_a=a, user_b=b, agreed=agreed, channels=channels, log=["x"])


def test_on_result_builds_plan_and_roi_history(seeded, fake_llm, ctx):
    add_interaction(transcript_ref="i-ab", recording_consent={"alice": True, "bob": True})
    store.put(TRANSCRIPTS, "i-ab", {"text": "Bob offered a referral."})
    pe.in_flight.add("alice__bob")
    asyncio.run(pe.on_result(ctx, "agent1rep", result_msg(True, ["email"])))
    plan = load(NextStepPlan, PLANS, "alice__bob")
    assert plan.channels == [C.EMAIL] and plan.agreed
    assert plan.drafts == {"alice": "Hi Bob, thanks for the chat!", "bob": "Hi Alice, great meeting you!"}
    assert plan.suggested_timing == pe.CHANNEL_TIMING[C.EMAIL] and plan.rationale == "Both like email."
    assert fake_llm[0]["transcript"] == "Bob offered a referral." and fake_llm[0]["channel"] == "email"
    entries = [RoiHistoryEntry.model_validate(e) for e in store.list(ROI_HISTORY)]
    assert {e.user_id for e in entries} == {"alice", "bob"} and all(e.outcome is None and e.roi_score_at_match == 70 for e in entries)
    assert "alice__bob" not in pe.in_flight


def test_on_result_fallbacks(seeded, ctx, monkeypatch):
    async def down(*args, **kwargs):
        raise RuntimeError("LLM down")

    monkeypatch.setattr(pe, "llm_complete", down)
    add_interaction()
    set_prefs("alice", C.INSTAGRAM, C.EMAIL, C.LINKEDIN)
    set_prefs("bob", C.INTERVIEW, C.EMAIL, C.LINKEDIN)
    asyncio.run(pe.on_result(ctx, "agent1rep", result_msg(False, [])))
    plan = load(NextStepPlan, PLANS, "alice__bob")
    assert plan.channels == [C.LINKEDIN] and not plan.agreed and "fallback" in plan.negotiation_log[-1]
    assert plan.drafts["alice"].startswith("Hi Bob Rivera")  # template draft when the LLM is unavailable

    add_interaction("i-ad", "alice", "dave")
    asyncio.run(pe.on_result(ctx, "agent1rep", result_msg(False, [], b="dave", iid="i-ad")))
    plan = load(NextStepPlan, PLANS, "alice__dave")
    assert plan.channels == [C.NONE] and plan.drafts == {"alice": "", "dave": ""}


def test_on_result_tolerates_wrong_llm_types(seeded, ctx, monkeypatch):
    async def odd(system, user, max_tokens=1024):
        return '{"draft_a": {"subject": "Hi", "body": "Thanks"}, "draft_b": null}'

    monkeypatch.setattr(pe, "llm_complete", odd)
    add_interaction()
    pe.in_flight.add("alice__bob")
    asyncio.run(pe.on_result(ctx, "agent1rep", result_msg(True, ["email"])))
    plan = load(NextStepPlan, PLANS, "alice__bob")
    assert "Thanks" in plan.drafts["alice"] and plan.drafts["bob"] == "" and "alice__bob" not in pe.in_flight


def test_on_result_ignores_unknown_interaction(ctx):
    pe.in_flight.add("alice__bob")
    asyncio.run(pe.on_result(ctx, "agent1rep", result_msg(True, ["email"], iid="missing")))
    assert store.list(PLANS) == [] and "alice__bob" not in pe.in_flight


def test_run_pending_dedupes_and_skips_declined(seeded):
    add_interaction("i-1")
    add_interaction("i-2", "bob", "alice")  # same pair, other direction
    add_interaction("i-3", "alice", "dave", status="declined")
    assert pe.run_pending() == ["alice__bob"]
    assert pe.run_pending() == []  # already in flight
    (destination, start), = [pe.outbox._queue.get_nowait() for _ in range(pe.outbox._queue.qsize())]
    assert destination == pe.rep_a.address and start.max_turns == pe.config.MAX_NEGOTIATION_TURNS


def test_followup_chat(seeded, fake_llm, ctx):
    asyncio.run(pe.answer(ctx, "agent1user", "link test-link-alice-0123456789abcdef"))
    assert "No follow-up plans" in asyncio.run(pe.answer(ctx, "agent1user", "show my follow-ups"))[0]
    add_interaction()
    asyncio.run(pe.on_result(ctx, "agent1rep", result_msg(True, ["email"])))
    reply, _ = asyncio.run(pe.answer(ctx, "agent1user", "show my follow-ups"))
    assert "bob" in reply and "Hi Bob, thanks for the chat!" in reply


# --- HTTP ------------------------------------------------------------------------------------------------------------------

@pytest.fixture
def plan(seeded, fake_llm):
    add_interaction()
    asyncio.run(pe.on_result(FakeCtx(), "agent1rep", result_msg(True, ["email"])))
    return load(NextStepPlan, PLANS, "alice__bob")


def test_preferences_endpoint():
    r = client.post("/preferences", json={"user_id": "erin", "allowed_channels": ["linkedin"], "handles": {"linkedin": "in/erin"}})
    assert r.json()["allowed_channels"] == ["linkedin"]
    assert load(UserProfile, PROFILES, "erin").followup_prefs.handles == {"linkedin": "in/erin"}
    assert client.post("/preferences", json={"user_id": "erin", "allowed_channels": ["carrier-pigeon"]}).status_code == 422


def test_run_endpoint(seeded):
    add_interaction()
    assert client.post("/followups/run").json() == {"started": ["alice__bob"]}


def test_get_followups(plan):
    (view,) = client.get("/followups/bob").json()
    assert view["peer_id"] == "alice" and view["your_draft"] == "Hi Alice, great meeting you!" and view["approved"] is False
    assert client.get("/followups/nobody").json() == []


def test_approve_uses_send_stub_only_after_approval(plan, monkeypatch):
    sent = []
    r = client.post("/followups/alice__bob/approve", json={"user_id": "alice"})
    assert r.json()["approved"] and r.json()["send_status"] == "approved; sending not implemented (stub)"
    assert client.post("/followups/alice__bob/approve", json={"user_id": "mallory"}).status_code == 403
    assert client.post("/followups/missing/approve", json={"user_id": "alice"}).status_code == 404

    async def fake_send(channel, from_user_id, to_user_id, message):
        sent.append((channel, from_user_id, to_user_id, message))
        return "msg-1"

    monkeypatch.setattr(pe, "send_outreach", fake_send)
    assert client.post("/followups/alice__bob/approve", json={"user_id": "bob"}).json()["send_status"] == "sent:msg-1"
    assert sent == [("email", "bob", "alice", "Hi Alice, great meeting you!")]


def test_approve_none_channel_sends_nothing(seeded, ctx):
    add_interaction("i-ad", "alice", "dave")
    asyncio.run(pe.on_result(ctx, "agent1rep", result_msg(False, [], b="dave", iid="i-ad")))
    assert client.post("/followups/alice__dave/approve", json={"user_id": "dave"}).json()["send_status"] == "nothing to send"


def test_outcome_and_roi_history(plan):
    r = client.post("/followups/alice__bob/outcome", json={"user_id": "alice", "outcome": "interview"})
    assert r.status_code == 200 and r.json()["outcome"] == "interview"
    (entry,) = client.get("/roi-history/alice").json()
    assert entry["outcome"] == "interview" and entry["target_id"] == "bob"
    assert client.get("/roi-history/bob").json()[0]["outcome"] is None


def test_health():
    assert client.get("/health").json()["status"] == "ok"
