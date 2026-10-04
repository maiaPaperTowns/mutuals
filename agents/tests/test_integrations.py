import asyncio
from datetime import timedelta
from io import BytesIO

import pytest

import integrations
from fake_data import NOW, events, live_update, profiles
from integrations import JsonFileStore, VectorDBClient


def test_store_roundtrip_list_delete(tmp_path):
    store = JsonFileStore(tmp_path)
    store.put("things", "a/b c", {"n": 1, "when": NOW})
    assert store.get("things", "a/b c") == {"n": 1, "when": str(NOW)}
    assert (tmp_path / "things" / "a_b_c.json").exists()  # unsafe key characters sanitised
    store.put("things", "z", {"n": 2})
    assert [r["n"] for r in store.list("things")] == [1, 2]
    store.delete("things", "z")
    assert store.get("things", "z") is None and store.list("missing") == []


@pytest.mark.parametrize("call", [
    lambda: VectorDBClient().upsert("c", "id", [0.1], {}),
    lambda: VectorDBClient().query("c", [0.1], 5, None),
    lambda: integrations.embed("text"),
    lambda: integrations.start_recording("s"),
    lambda: integrations.stop_recording("s"),
    lambda: integrations.transcribe("ref"),
    lambda: integrations.send_push("u", "t", "b"),
    lambda: integrations.send_outreach("email", "a", "b", "hi"),
])
def test_stubs_raise_not_implemented(call):
    with pytest.raises(NotImplementedError):
        asyncio.run(call())


def test_pdf_to_text_parses_a_pdf():
    from pypdf import PdfWriter

    writer, buf = PdfWriter(), BytesIO()
    writer.add_blank_page(width=200, height=200)
    writer.write(buf)
    assert integrations.pdf_to_text(buf.getvalue()) == ""


def test_load_transcript():
    integrations.store.put(integrations.TRANSCRIPTS, "i1", {"text": "hello"})
    assert asyncio.run(integrations.load_transcript("i1")) == ""
    integrations.store.put(integrations.INTERACTIONS, "i1", {"user_id": "alice", "target_id": "bob", "recording_consent": {"alice": True, "bob": True}})
    assert asyncio.run(integrations.load_transcript("i1")) == "hello"
    assert asyncio.run(integrations.load_transcript(None)) == ""
    assert asyncio.run(integrations.load_transcript("missing")) == ""


def test_model_subject_conversions():
    alice = profiles()["alice"].to_subject()
    assert alice.id == "alice" and "ML internship" in alice.goals and alice.position is None
    fair = events()[0]
    subject = fair.to_subject()
    assert subject.windows == ((fair.start, fair.end),) and subject.position.zone == "atrium"
    assert fair.duration_minutes == 120


def test_profile_update_status_mapping():
    assert live_update("bob", availability={"status": "busy"}).to_subject().open_to_chat is False
    assert live_update("bob", availability={"status": "in_session"}).to_subject().in_session is True
    until = NOW + timedelta(minutes=20)
    assert live_update("bob", availability={"free_until": until}).to_subject().windows == ((NOW, until),)


def test_delete_account_removes_related_records_and_keeps_other_accounts(tmp_path):
    store = JsonFileStore(tmp_path)
    store.put(integrations.PROFILES, "bob", {"user_id": "bob"})
    store.put(integrations.PROFILES, "alice", {"user_id": "alice"})
    store.put_presence("bob", {"user_id": "bob"})
    store.put(integrations.INTERACTIONS, "i-ab", {"interaction_id": "i-ab", "user_id": "alice", "target_id": "bob"})
    store.put(integrations.TRANSCRIPTS, "i-ab", {"text": "private"})
    store.put(integrations.PLANS, "ab", {"plan_id": "ab", "user_a": "alice", "user_b": "bob", "interaction_id": "i-ab"})
    store.put(integrations.ROI_HISTORY, "h-ab", {"entry_id": "h-ab", "user_id": "alice", "target_id": "bob", "interaction_id": "i-ab"})
    store.put(integrations.ROI_HISTORY, "orphan-bob", {"entry_id": "orphan-bob", "user_id": "alice", "target_id": "bob", "interaction_id": "missing-interaction"})
    store.delete_account("bob")
    assert store.get(integrations.PROFILES, "bob") is None
    assert store.get(integrations.PROFILES, "alice") is not None
    assert store.list_presence() == []
    assert store.list(integrations.INTERACTIONS) == []
    assert store.list(integrations.TRANSCRIPTS) == []
    assert store.list(integrations.PLANS) == []
    assert store.list(integrations.ROI_HISTORY) == []


@pytest.mark.parametrize("reference", ["plan", "roi_owner", "roi_target"])
def test_delete_account_cascades_orphan_transcript_references(tmp_path, reference):
    store = JsonFileStore(tmp_path)
    store.put(integrations.PROFILES, "alice", {"user_id": "alice"})
    store.put(integrations.PROFILES, "bob", {"user_id": "bob"})
    store.put(integrations.TRANSCRIPTS, "orphan-i", {"interaction_id": "orphan-i", "text": "Alice's private chat"})
    if reference == "plan":
        store.put(integrations.PLANS, "orphan-plan", {"plan_id": "orphan-plan", "user_a": "alice", "user_b": "bob", "interaction_id": "orphan-i"})
    else:
        owner, target = ("alice", "bob") if reference == "roi_owner" else ("bob", "alice")
        store.put(integrations.ROI_HISTORY, "orphan-roi", {"entry_id": "orphan-roi", "user_id": owner, "target_id": target, "interaction_id": "orphan-i"})
    unrelated_plan = {"plan_id": "other-plan", "user_a": "bob", "user_b": "carol", "interaction_id": "other-i"}
    unrelated_history = {"entry_id": "other-roi", "user_id": "bob", "target_id": "carol", "interaction_id": "other-i"}
    unrelated_transcript = {"interaction_id": "other-i", "text": "Unrelated chat"}
    store.put(integrations.PLANS, "other-plan", unrelated_plan)
    store.put(integrations.ROI_HISTORY, "other-roi", unrelated_history)
    store.put(integrations.TRANSCRIPTS, "other-i", unrelated_transcript)
    store.delete_account("alice")
    assert store.get(integrations.TRANSCRIPTS, "orphan-i") is None
    assert store.get(integrations.PLANS, "orphan-plan") is None
    assert store.get(integrations.ROI_HISTORY, "orphan-roi") is None
    assert store.get(integrations.PROFILES, "alice") is None
    assert store.get(integrations.PROFILES, "bob") == {"user_id": "bob"}
    assert store.list(integrations.PLANS) == [unrelated_plan]
    assert store.list(integrations.ROI_HISTORY) == [unrelated_history]
    assert store.list(integrations.TRANSCRIPTS) == [unrelated_transcript]
