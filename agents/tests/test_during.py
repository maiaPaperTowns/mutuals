import asyncio
from datetime import timedelta

import pytest
from auth_helpers import TestClient

import during
import fake_data
from common import load
from integrations import INTERACTIONS, TRANSCRIPTS, store
from models import ConnectIntent, Interaction, MatchesUpdate, ParticipantLeft, ProfileUpdate, utcnow

client = TestClient(during.app)


@pytest.fixture(autouse=True)
def reset_state():
    for state in (during.live, during.last_seen, during.sent_signatures, during.participants):
        state.clear()
    for box in (during.matchmaker_outbox, during.participant_outbox):
        while not box._queue.empty():
            box._queue.get_nowait()


def check_in(ctx, *user_ids, **overrides):
    for user_id in user_ids:
        asyncio.run(during.on_profile_update(ctx, "agent1host", fake_data.live_update(user_id, **overrides)))


def drain(box):
    out = []
    while not box._queue.empty():
        out.append(box._queue.get_nowait())
    return out


# --- MatchmakerAgent ------------------------------------------------------------------------------------------

def test_compute_cards_ranks_and_respects_opt_in(ctx):
    check_in(ctx, "alice", "bob", "carol", "dave")
    cards = during.compute_cards("alice")
    ids = [c.target_id for c in cards]
    assert ids[0] == "bob" and "carol" not in ids  # carol is not discoverable
    assert all(c.roi_score >= during.config.MATCH_THRESHOLD for c in cards)
    assert cards[0].reason_for_connection and cards[0].location.zone == "atrium"
    assert during.compute_cards("nobody") == []


def test_threshold_filters_low_roi(ctx, monkeypatch):
    check_in(ctx, "alice", "bob", "dave")
    monkeypatch.setattr(during.config, "MATCH_THRESHOLD", 101.0)
    assert during.compute_cards("alice") == []


def test_rematch_pushes_only_changes_and_removes_stale(ctx):
    check_in(ctx, "alice", "bob")
    asyncio.run(during.rematch(ctx))
    pushed = {m.user_id: m for _, m in ctx.sent if isinstance(m, MatchesUpdate)}
    assert pushed["alice"].cards[0].target_id == "bob"
    ctx.sent.clear()
    asyncio.run(during.rematch(ctx))
    assert ctx.sent == []  # nothing changed, nothing re-sent

    during.last_seen["bob"] = utcnow() - timedelta(seconds=during.config.STALE_TIMEOUT_S + 1)
    asyncio.run(during.rematch(ctx))
    assert "bob" not in during.live
    assert [m.cards for _, m in ctx.sent if m.user_id == "alice"] == [[]]


def test_participant_left(ctx):
    check_in(ctx, "alice")
    asyncio.run(during.on_left(ctx, "agent1host", ParticipantLeft(user_id="alice")))
    assert "alice" not in during.live


def test_matchmaker_chat(ctx):
    asyncio.run(during.answer(ctx, "agent1user", "link test-link-alice-0123456789abcdef"))
    assert "not checked in" in asyncio.run(during.answer(ctx, "agent1user", "who should I meet?"))[0]
    check_in(ctx, "alice", "bob")
    reply, end = asyncio.run(during.answer(ctx, "agent1user", "who should I meet?"))
    assert "Bob Rivera" in reply and not end
    assert asyncio.run(during.answer(ctx, "agent1user", "bye"))[1] is True


# --- ParticipantAgent -----------------------------------------------------------------------------------------

def test_build_update_merges_stored_profile(seeded):
    update = during.get_participant("bob").build_update({"location": {"zone": "hall-b"}, "bogus": 1})
    assert isinstance(update, ProfileUpdate)
    assert update.role == "recruiter" and update.discoverable is True and update.location.zone == "hall-b"


def test_deliver_queues_when_offline_and_push_stub_is_tolerated(ctx):
    msg = ConnectIntent(interaction_id="i1", from_user_id="alice", from_name="Alice", target_id="bob", roi_score=70, reason="r")
    asyncio.run(during.on_connect_intent(ctx, "agent1mm", msg))
    assert during.participants["bob"].pending[0]["type"] == "connect_request"


# --- HTTP / WebSocket --------------------------------------------------------------------------------------------

def test_presence_endpoint_relays_to_matchmaker(seeded):
    r = client.post("/presence", json={"user_id": "alice", "location": {"zone": "atrium", "x": 1, "y": 2}})
    assert r.status_code == 200 and r.json()["name"] == "Alice Chen"
    (destination, update), = drain(during.participant_outbox)
    assert destination == during.matchmaker.address and update.location.x == 1
    assert client.post("/presence", json={}).status_code == 422


def test_websocket_update_flushes_pending_and_connects(seeded, ctx):
    check_in(ctx, "alice", "bob")
    asyncio.run(during.on_matches(ctx, "agent1mm", MatchesUpdate(user_id="alice", cards=during.compute_cards("alice"), generated_at=utcnow())))
    with client.websocket_connect("/ws/alice") as ws:
        first = ws.receive_json()
        assert first["type"] == "matches" and first["cards"][0]["target_id"] == "bob"
        ws.send_json({"type": "update", "availability": {"status": "free"}})
        assert ws.receive_json() == {"type": "ack"}
        ws.send_json({"type": "connect", "target_id": "bob"})
        assert ws.receive_json()["interaction"]["target_id"] == "bob"
        ws.send_json({"type": "connect", "target_id": "carol"})
        assert ws.receive_json()["type"] == "error"
        ws.send_json({"type": "nope"})
        assert ws.receive_json()["type"] == "error"
        ws.send_json({"type": "leave"})
        assert ws.receive_json() == {"type": "ack"}
    kinds = [type(m).__name__ for _, m in drain(during.participant_outbox)]
    assert kinds == ["ProfileUpdate", "ParticipantLeft"]
    assert during.participants["alice"].socket is None


def test_websocket_survives_malformed_messages(seeded):
    with client.websocket_connect("/ws/alice") as ws:
        ws.send_text("{not json")
        assert ws.receive_json()["type"] == "error"
        ws.send_json({"type": "connect"})  # missing target_id
        assert ws.receive_json()["type"] == "error"
        ws.send_json({"type": "update"})
        assert ws.receive_json() == {"type": "ack"}
    assert during.participants["alice"].socket is None


def test_opportunities_endpoint(ctx):
    assert client.get("/opportunities/alice").status_code == 404
    check_in(ctx, "alice", "bob")
    cards = client.get("/opportunities/alice").json()
    assert cards[0]["target_id"] == "bob" and set(cards[0]) >= {"target_name", "role", "location", "roi_score", "reason_for_connection", "breakdown"}


def test_connect_and_respond(ctx):
    assert client.post("/connect", json={"user_id": "alice", "target_id": "bob"}).status_code == 409
    check_in(ctx, "alice", "bob", "carol")
    assert client.post("/connect", json={"user_id": "alice", "target_id": "carol"}).status_code == 404
    r = client.post("/connect", json={"user_id": "alice", "target_id": "bob"})
    interaction = r.json()
    assert r.status_code == 200 and interaction["roi_score_at_match"] > 0
    (destination, intent), = drain(during.matchmaker_outbox)
    assert destination == during.participant_host.address and intent.target_id == "bob"

    iid = interaction["interaction_id"]
    assert client.post("/connect/respond", json={"interaction_id": iid, "user_id": "alice", "accept": True}).status_code == 403
    r = client.post("/connect/respond", json={"interaction_id": iid, "user_id": "bob", "accept": True})
    assert r.json()["status"] == "accepted"
    assert during.participants["alice"].pending[-1]["type"] == "connect_response"
    assert client.get(f"/interactions/{iid}", params={"user_id": "bob"}).status_code == 200
    assert client.get(f"/interactions/{iid}", params={"user_id": "mallory"}).status_code == 403
    assert client.get("/interactions/missing", params={"user_id": "bob"}).status_code == 404


@pytest.fixture
def interaction():
    record = Interaction(interaction_id="i-ab", user_id="alice", target_id="bob")
    store.put(INTERACTIONS, record.interaction_id, record.model_dump(mode="json"))
    return record


def consent(user_id, value=True):
    return client.post("/record/consent", json={"interaction_id": "i-ab", "user_id": user_id, "consent": value})


def test_recording_requires_both_consents_and_stub_returns_501(interaction):
    body = {"interaction_id": "i-ab", "user_id": "alice"}
    assert client.post("/record/start", json=body).status_code == 403
    consent("alice")
    assert client.post("/record/start", json=body).status_code == 403
    consent("bob")
    assert client.post("/record/start", json=body).status_code == 501
    assert client.post("/record/stop", json=body).status_code == 409
    assert consent("mallory").status_code == 403


def test_recording_success_path_with_fake_elevenlabs(interaction, monkeypatch):
    calls = []

    async def start(session_id):
        calls.append(("start", session_id))

    async def stop(session_id):
        calls.append(("stop", session_id))
        return "audio-123"

    async def transcribe(audio_ref):
        return "We talked about ML internships."

    monkeypatch.setattr(during, "start_recording", start)
    monkeypatch.setattr(during, "stop_recording", stop)
    monkeypatch.setattr(during, "transcribe", transcribe)
    consent("alice"), consent("bob")
    body = {"interaction_id": "i-ab", "user_id": "bob"}
    assert client.post("/record/start", json=body).json()["recording_active"] is True
    assert client.post("/record/start", json=body).status_code == 409
    result = client.post("/record/stop", json=body).json()
    assert result["status"] == "recorded" and result["audio_ref"] == "audio-123" and result["transcript_ref"] == "i-ab"
    assert store.get(TRANSCRIPTS, "i-ab")["text"] == "We talked about ML internships."
    assert calls == [("start", "i-ab"), ("stop", "i-ab")]


def test_revoking_consent_stops_recording(interaction, monkeypatch):
    stopped = []

    async def start(session_id):
        pass

    async def stop(session_id):
        stopped.append(session_id)
        return "audio"

    monkeypatch.setattr(during, "start_recording", start)
    monkeypatch.setattr(during, "stop_recording", stop)
    consent("alice"), consent("bob")
    client.post("/record/start", json={"interaction_id": "i-ab", "user_id": "alice"})
    assert consent("bob", False).json()["recording_active"] is False
    assert stopped == ["i-ab"] and load(Interaction, INTERACTIONS, "i-ab").transcript_ref is None


def test_health(ctx):
    check_in(ctx, "alice")
    assert client.get("/health").json()["live_participants"] == 1


def test_presence_persists_and_restores_after_restart(ctx):
    update = fake_data.live_update("alice")
    asyncio.run(during.on_profile_update(ctx, "agent1host", update))
    rows = store.list_presence()
    assert len(rows) == 1 and rows[0]["user_id"] == "alice"
    assert isinstance(rows[0]["timestamp"], str)
    assert during.live["alice"].location.zone == update.location.zone
    during.live.clear()
    during.last_seen.clear()
    asyncio.run(during.restore_presence(ctx))
    assert during.live["alice"].name == "Alice Chen"
    assert during.last_seen["alice"] == update.timestamp


def test_restore_presence_expires_stale_records(ctx):
    update = fake_data.live_update("bob")
    update.timestamp = utcnow() - timedelta(seconds=during.config.STALE_TIMEOUT_S + 1)
    store.put_presence("bob", during.as_json(update))
    asyncio.run(during.restore_presence(ctx))
    assert "bob" not in during.live
    assert store.list_presence() == []


def test_rematch_expires_persisted_presence(ctx):
    check_in(ctx, "alice")
    assert len(store.list_presence()) == 1
    during.last_seen["alice"] = utcnow() - timedelta(seconds=during.config.STALE_TIMEOUT_S + 1)
    asyncio.run(during.rematch(ctx))
    assert store.list_presence() == []
    assert "alice" not in during.live and "alice" not in during.last_seen


def delete_from_another_process(user_id):
    from integrations import JsonFileStore
    JsonFileStore(store.root).delete_account(user_id)


def test_deleted_target_disappears_from_opportunities_immediately(ctx, seeded):
    check_in(ctx, "alice", "bob")
    participant = during.get_participant("bob")
    participant.pending.append({"type": "matches", "cards": [{"target_id": "alice"}]})
    delete_from_another_process("bob")
    assert client.get("/opportunities/alice").json() == []
    assert "bob" not in during.live and "bob" not in during.participants
    assert participant.pending == [] and participant.profile is None


def test_deleted_user_cannot_read_cached_opportunities(ctx):
    check_in(ctx, "alice", "bob")
    delete_from_another_process("alice")
    assert client.get("/opportunities/alice").status_code == 404


@pytest.mark.parametrize("deleted,status", [("alice", 409), ("bob", 404)])
def test_deleted_account_cannot_create_or_receive_cached_connections(ctx, deleted, status):
    check_in(ctx, "alice", "bob")
    delete_from_another_process(deleted)
    response = client.post("/connect", json={"user_id": "alice", "target_id": "bob"})
    assert response.status_code == status
    assert store.list(INTERACTIONS) == []
    assert drain(during.matchmaker_outbox) == []


def test_deleted_account_chat_cannot_return_cached_matches(ctx):
    check_in(ctx, "alice", "bob")
    asyncio.run(during.answer(ctx, "agent1alice", "link test-link-alice-0123456789abcdef"))
    delete_from_another_process("alice")
    reply, end = asyncio.run(during.answer(ctx, "agent1alice", "who should I meet?"))
    assert "not checked in" in reply and not end
    assert "Bob Rivera" not in reply


def test_rematch_syncs_deletion_and_reads_presence_once(ctx, monkeypatch):
    check_in(ctx, "alice", "bob", "dave")
    during.sent_signatures["bob"] = (("alice", 50),)
    participant = during.get_participant("bob")
    participant.pending.append({"type": "matches", "cards": []})
    delete_from_another_process("bob")
    reads = []
    list_presence = store.list_presence

    def count_reads():
        reads.append(True)
        return list_presence()

    monkeypatch.setattr(store, "list_presence", count_reads)
    asyncio.run(during.rematch(ctx))
    assert len(reads) == 1
    assert "bob" not in during.live and "bob" not in during.last_seen
    assert "bob" not in during.sent_signatures and "bob" not in during.participants
    assert participant.pending == []
    assert all(message.user_id != "bob" and all(card.target_id != "bob" for card in message.cards) for _, message in ctx.sent)


def test_opportunities_fail_closed_if_authoritative_presence_unavailable(ctx, monkeypatch):
    check_in(ctx, "alice", "bob")

    def unavailable():
        raise RuntimeError("gateway unavailable")

    monkeypatch.setattr(store, "list_presence", unavailable)
    with pytest.raises(RuntimeError, match="gateway unavailable"):
        during.compute_cards("alice")
