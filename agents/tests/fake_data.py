"""Deterministic fake data for tests and local demos. No real people or secrets."""

from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone
from typing import Any

from models import Availability, EventInfo, FollowUpChannel, FollowUpPreferences, Location, ProfileUpdate, UserProfile

NOW = datetime.now(timezone.utc).replace(microsecond=0)

RESUME_TEXT = """Alice Chen - B.S. Computer Science, University of Michigan (2027)
Skills: Python, PyTorch, computer vision, SQL
Experience: Research assistant, UM Vision Lab (2025-present); Software intern, Acme Robotics (summer 2025)
Interests: machine learning, robotics, startups
Looking for: an ML internship for summer 2027"""

# What the mocked LLM "extracts" from RESUME_TEXT.
LLM_PROFILE_JSON = json.dumps({
    "name": "Alice Chen", "role": "student", "headline": "CS student building vision models",
    "skills": ["python", "pytorch", "computer vision", "sql"],
    "experience": ["Research assistant, UM Vision Lab", "Software intern, Acme Robotics"],
    "interests": ["machine learning", "robotics", "startups"],
    "goals": ["ML internship"], "offerings": ["computer vision projects"], "seniority": 1,
})


def profiles() -> dict[str, UserProfile]:
    return {
        "alice": UserProfile(
            user_id="alice", name="Alice Chen", role="student", skills=["python", "pytorch", "computer vision"],
            interests=["machine learning", "robotics"], goals=["ML internship", "meet recruiters"],
            offerings=["computer vision projects"], seniority=1, discoverable=True,
            followup_prefs=FollowUpPreferences(allowed_channels=[FollowUpChannel.INSTAGRAM, FollowUpChannel.EMAIL, FollowUpChannel.LINKEDIN]),
        ),
        "bob": UserProfile(
            user_id="bob", name="Bob Rivera", role="recruiter", skills=["python", "machine learning"],
            goals=["hire ML interns"], offerings=["ML internship referrals", "resume reviews"], seniority=4, discoverable=True,
            followup_prefs=FollowUpPreferences(allowed_channels=[FollowUpChannel.INTERVIEW, FollowUpChannel.LINKEDIN, FollowUpChannel.EMAIL]),
        ),
        "carol": UserProfile(
            user_id="carol", name="Carol Park", role="founder", skills=["robotics"], goals=["find cofounder"],
            offerings=["startup internship"], seniority=3, discoverable=False,
        ),
        "dave": UserProfile(
            user_id="dave", name="Dave Kim", role="student", skills=["poetry"], goals=["publish poems"],
            interests=["literature"], seniority=1, discoverable=True,
            followup_prefs=FollowUpPreferences(allowed_channels=[FollowUpChannel.INTERVIEW]),
        ),
    }


def events() -> list[EventInfo]:
    return [
        EventInfo(event_id="career-fair", title="ML Career Fair", host_role="recruiter",
                  topics=["machine learning", "internship"], offerings=["recruiters", "internship interviews"],
                  start=NOW + timedelta(hours=1), end=NOW + timedelta(hours=3), zone="atrium", x=0, y=0),
        EventInfo(event_id="vision-talk", title="Computer Vision Tech Talk", host_role="researcher",
                  topics=["computer vision", "pytorch"], offerings=["research lab openings"],
                  start=NOW + timedelta(hours=2), end=NOW + timedelta(hours=3), zone="hall-b", travel_minutes=8),
        EventInfo(event_id="poetry-night", title="Poetry Night", topics=["poetry"], offerings=["open mic"],
                  start=NOW + timedelta(hours=1), end=NOW + timedelta(hours=2)),
        EventInfo(event_id="past-talk", title="Yesterday's ML Talk", topics=["machine learning"],
                  start=NOW - timedelta(hours=26), end=NOW - timedelta(hours=25)),
    ]


def live_update(user_id: str, **overrides: Any) -> ProfileUpdate:
    """ProfileUpdate built from the fake profile plus live location/status."""
    p = profiles()[user_id]
    positions = {"alice": (0, 0), "bob": (20, 0), "carol": (30, 10), "dave": (400, 300)}
    x, y = positions[user_id]
    fields: dict[str, Any] = dict(
        user_id=p.user_id, name=p.name, role=p.role, goals=p.goals, skills=p.skills, interests=p.interests,
        offerings=p.offerings, seniority=p.seniority, discoverable=p.discoverable,
        location=Location(zone="atrium" if user_id != "dave" else "hall-b", x=x, y=y),
        availability=Availability(), timestamp=NOW,
    )
    fields.update(overrides)
    return ProfileUpdate(**fields)
