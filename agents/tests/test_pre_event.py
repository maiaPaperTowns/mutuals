import asyncio
from datetime import timedelta
from io import BytesIO

import pytest
from auth_helpers import TestClient

import fake_data
import integrations
import pre_event
from common import load
from integrations import PROFILES, VectorMatch
from models import UserProfile

client = TestClient(pre_event.app)


@pytest.fixture
def fake_llm(monkeypatch):
    """Patch the LLM; returns a list of prompts it received."""
    calls = []

    async def llm(system, user, max_tokens=1024):
        calls.append((system, user))
        return fake_data.LLM_PROFILE_JSON if system == pre_event.PROFILE_PROMPT else "Go to the ML Career Fair."

    monkeypatch.setattr(pre_event, "llm_complete", llm)
    return calls


class FakeVectors:
    def __init__(self, ids=()):
        self.upserts, self.ids = [], list(ids)

    async def upsert(self, collection, id, embedding, metadata):
        self.upserts.append((collection, id))

    async def query(self, collection, embedding, top_k=10, filters=None):
        return [VectorMatch(id=i, score=1.0) for i in self.ids]


# --- functions ---------------------------------------------------------------------------------------------

def test_extract_profile_maps_llm_json(fake_llm):
    profile = asyncio.run(pre_event.extract_profile("alice", fake_data.RESUME_TEXT, "Alice C."))
    assert profile.name == "Alice C." and "pytorch" in profile.skills and profile.goals == ["ML internship"]


def test_extract_profile_keeps_user_settings_on_reupload(seeded, fake_llm):
    profile = asyncio.run(pre_event.extract_profile("alice", fake_data.RESUME_TEXT, None))
    assert profile.discoverable is True and profile.goals == ["ML internship", "meet recruiters"]


def test_extract_profile_tolerates_sloppy_llm_json(monkeypatch):
    async def sloppy(system, user, max_tokens=1024):
        return '{"name": "Al", "headline": null, "skills": "python, sql", "seniority": "9", "goals": null, "user_id": "evil"}'

    monkeypatch.setattr(pre_event, "llm_complete", sloppy)
    profile = asyncio.run(pre_event.extract_profile("alice", "resume", None))
    assert profile.user_id == "alice" and profile.skills == ["python", "sql"] and profile.headline == ""
    assert profile.seniority == 5 and profile.goals == []


def test_events_without_timezone_are_treated_as_utc(seeded):
    naive = {"event_id": "naive", "title": "ML Mixer", "topics": ["machine learning"],
             "start": (fake_data.NOW.replace(tzinfo=None) + timedelta(hours=1)).isoformat(),
             "end": (fake_data.NOW.replace(tzinfo=None) + timedelta(hours=2)).isoformat()}
    assert client.post("/events", json=naive).status_code == 200
    r = client.get("/events/recommendations", params={"user_id": "alice", "top_n": 10})
    assert r.status_code == 200 and "naive" in [x["event"]["event_id"] for x in r.json()]


def test_index_and_save_without_vector_db():
    profile = asyncio.run(pre_event.index_and_save(fake_data.profiles()["alice"]))
    assert profile.embedding is None and load(UserProfile, PROFILES, "alice").name == "Alice Chen"


def test_index_and_save_with_vector_db(monkeypatch):
    vectors = FakeVectors()
    monkeypatch.setattr(pre_event, "vectors", vectors)

    async def fake_embed(text):
        return [0.1, 0.2]

    monkeypatch.setattr(pre_event, "embed", fake_embed)
    profile = asyncio.run(pre_event.index_and_save(fake_data.profiles()["alice"]))
    assert profile.embedding == [0.1, 0.2] and vectors.upserts == [("profiles", "alice")]


def test_candidate_events_falls_back_to_full_scan(seeded):
    events = asyncio.run(pre_event.candidate_events(fake_data.profiles()["alice"]))
    assert len(events) == len(fake_data.events())


def test_candidate_events_uses_vector_hits(seeded, monkeypatch):
    for event in integrations.store.list(integrations.EVENTS):
        event["embedding"] = [0.1]
        integrations.store.put(integrations.EVENTS, event["event_id"], event)
    monkeypatch.setattr(pre_event, "vectors", FakeVectors(ids=["vision-talk", "deleted-event"]))
    profile = fake_data.profiles()["alice"].model_copy(update={"embedding": [0.1]})
    assert [e.event_id for e in asyncio.run(pre_event.candidate_events(profile))] == ["vision-talk"]


def test_recommend_ranks_and_skips_past_events(seeded):
    recs = asyncio.run(pre_event.recommend("alice", 10))
    ids = [r.event.event_id for r in recs]
    assert "past-talk" not in ids and ids[-1] == "poetry-night"
    assert recs == sorted(recs, key=lambda r: r.roi_score, reverse=True)
    assert asyncio.run(pre_event.recommend("alice", 1))[0].event.event_id == ids[0]
    with pytest.raises(KeyError):
        asyncio.run(pre_event.recommend("nobody", 3))


# --- HTTP --------------------------------------------------------------------------------------------------------

def test_post_resume_text(fake_llm):
    r = client.post("/resume", data={"user_id": "alice", "text": fake_data.RESUME_TEXT})
    assert r.status_code == 200 and r.json()["role"] == "student"


def test_post_resume_txt_file(fake_llm):
    files = {"file": ("resume.txt", fake_data.RESUME_TEXT.encode(), "text/plain")}
    r = client.post("/resume", data={"user_id": "alice", "name": "Alice"}, files=files)
    assert r.status_code == 200 and r.json()["name"] == "Alice"
    assert "Vision Lab" in fake_llm[0][1]


def test_post_resume_pdf_file(fake_llm):
    from pypdf import PdfWriter

    writer, buf = PdfWriter(), BytesIO()
    writer.add_blank_page(width=200, height=200)
    writer.write(buf)
    r = client.post("/resume", data={"user_id": "alice"}, files={"file": ("cv.pdf", buf.getvalue(), "application/pdf")})
    assert r.status_code == 200


SAMPLE_RESUME = pre_event.config.Path(__file__).with_name("TestResume.pdf")


@pytest.mark.skipif(not SAMPLE_RESUME.exists(), reason="TestResume.pdf not present")
def test_post_resume_real_pdf(fake_llm):
    files = {"file": ("TestResume.pdf", SAMPLE_RESUME.read_bytes(), "application/pdf")}
    r = client.post("/resume", data={"user_id": "sample"}, files=files)
    assert r.status_code == 200 and r.json()["user_id"] == "sample"
    assert "University of Michigan" in fake_llm[0][1]  # extracted PDF text reached the LLM


def test_post_resume_errors(monkeypatch):
    assert client.post("/resume", data={"user_id": "alice"}).status_code == 422

    async def broken(system, user, max_tokens=1024):
        return "not json"

    monkeypatch.setattr(pre_event, "llm_complete", broken)
    assert client.post("/resume", data={"user_id": "alice", "text": "x"}).status_code == 502


def test_post_goals_creates_and_updates_profile():
    r = client.post("/goals", json={"user_id": "erin", "goals": ["research lab"], "discoverable": True})
    assert r.status_code == 200 and r.json()["discoverable"] is True
    r = client.post("/goals", json={"user_id": "erin", "goals": ["PhD advice"]})
    assert r.json()["goals"] == ["PhD advice"] and r.json()["discoverable"] is True


def test_get_profile(seeded):
    assert client.get("/profile/alice").json()["name"] == "Alice Chen"
    assert client.get("/profile/nobody").status_code == 404


def test_post_events_and_recommendations(seeded):
    new = fake_data.events()[0].model_copy(update={"event_id": "hack-night", "title": "ML Hack Night"})
    assert client.post("/events", json=new.model_dump(mode="json")).status_code == 200
    r = client.get("/events/recommendations", params={"user_id": "alice", "top_n": 2})
    assert r.status_code == 200 and len(r.json()) == 2
    assert {"event", "roi_score", "breakdown", "reason"} <= set(r.json()[0])
    assert client.get("/events/recommendations", params={"user_id": "nobody"}).status_code == 404


def test_health():
    assert client.get("/health").json()["agent_address"].startswith("agent1")


# --- ASI:One chat ----------------------------------------------------------------------------------------------------

def test_chat_answer_flow(seeded, fake_llm, ctx):
    reply, end = asyncio.run(pre_event.answer(ctx, "agent1user", "which events should I go to?"))
    assert "link" in reply and not end
    asyncio.run(pre_event.answer(ctx, "agent1user", "link test-link-alice-0123456789abcdef"))
    reply, end = asyncio.run(pre_event.answer(ctx, "agent1user", "which events should I go to?"))
    assert reply == "Go to the ML Career Fair." and not end
    assert "ML Career Fair" in fake_llm[-1][1]  # rankings are passed to the LLM as grounding
    asyncio.run(pre_event.answer(ctx, "agent1user", "why this one?"))
    assert "which events should I go to?" in fake_llm[-1][1]  # previous turn included
    assert asyncio.run(pre_event.answer(ctx, "agent1user", "bye")) == ("Good luck at the events!", True)


def test_chat_answer_without_profile_or_llm(seeded, ctx, monkeypatch):
    asyncio.run(pre_event.answer(ctx, "agent1new", "link test-link-ghost-0123456789abcdef"))
    assert "No profile" in asyncio.run(pre_event.answer(ctx, "agent1new", "events?"))[0]

    async def down(*args, **kwargs):
        raise RuntimeError("LLM down")

    monkeypatch.setattr(pre_event, "llm_complete", down)
    asyncio.run(pre_event.answer(ctx, "agent1user", "link test-link-alice-0123456789abcdef"))
    reply, _ = asyncio.run(pre_event.answer(ctx, "agent1user", "events?"))
    assert reply.startswith("1. ")  # plain ranked list fallback
