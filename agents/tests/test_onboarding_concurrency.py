"""Concurrent HTTP intake must preserve each accepted supplement for one account."""
import asyncio
import json

import httpx
import pytest

import integrations
import pre_event
from auth_helpers import token_for
from common import load, save
from models import UserProfile


@pytest.fixture
def overlapping_extraction(monkeypatch):
    first_started = asyncio.Event()
    second_started = asyncio.Event()
    calls = []

    async def llm(system, user, max_tokens=1024):
        context = json.loads(user)
        calls.append(context)
        if len(calls) == 1:
            first_started.set()
            # Without serialization the second extraction releases the first; with a
            # per-user lock the first completes before the second can extract.
            try:
                await asyncio.wait_for(second_started.wait(), timeout=0.25)
            except TimeoutError:
                pass
        else:
            second_started.set()
        newest_message = context["introduction"].split("\n\n")[-1]
        return json.dumps({"skills": [newest_message]})

    monkeypatch.setattr(pre_event, "llm_complete", llm)
    return first_started, calls


async def submit_pair(first_started, first_message, second_message):
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=pre_event.app),
                                 base_url="http://testserver",
                                 headers={"authorization": "Bearer " + token_for("alice")}) as client:
        first = asyncio.create_task(client.post("/onboarding/input", data={"message": first_message}))
        await asyncio.wait_for(first_started.wait(), timeout=5)
        second = asyncio.create_task(client.post("/onboarding/input", data={"message": second_message}))
        return await asyncio.gather(first, second)


def test_concurrent_introductions_and_skills_are_both_preserved(overlapping_extraction):
    first_started, calls = overlapping_extraction
    save(integrations.PROFILES, "alice", UserProfile(user_id="alice", skills=["sql"]))
    first, second = asyncio.run(submit_pair(first_started, "python", "rust"))
    assert first.status_code == second.status_code == 200
    saved = load(UserProfile, integrations.PROFILES, "alice")
    assert saved.introduction == "python\n\nrust"
    assert saved.skills == ["sql", "python", "rust"]
    assert second.json()["introduction"] == saved.introduction
    assert second.json()["skills"] == saved.skills
    assert len(calls) == 2


def test_concurrent_messages_cannot_bypass_cumulative_limit(overlapping_extraction):
    first_started, calls = overlapping_extraction
    save(integrations.PROFILES, "alice", UserProfile(user_id="alice", introduction="x" * 9994, skills=["sql"]))
    first, second = asyncio.run(submit_pair(first_started, "one", "two"))
    assert first.status_code == 200
    assert second.status_code == 413
    saved = load(UserProfile, integrations.PROFILES, "alice")
    assert saved.introduction == "x" * 9994 + "\n\none"
    assert len(saved.introduction) == 9999
    assert saved.skills == ["sql", "one"]
    assert len(calls) == 1
