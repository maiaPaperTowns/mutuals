"""Tiny client for the Mutual iMessage bridge (Photon), for the ASI:One / Agentverse agent.

Flow: people talk to Mutual on ASI:One. When they share a phone number (their consent to iMessage intros),
call save_profile(). When the matchmaker finds a good pair, call offer_intro(). The bridge then runs the
double-yes over iMessage, and after both say yes, each gets the other's business card.

Env: BRIDGE_URL (e.g. https://….trycloudflare.com or http://localhost:8787), BRIDGE_KEY (ask Maia).
Note: on Photon's shared plan, each phone must also be added under Photon dashboard → Spectrum → Users.
"""
from __future__ import annotations

import json
import os
import urllib.request
from typing import Any

BRIDGE_URL = os.environ.get("BRIDGE_URL", "http://localhost:8787").rstrip("/")
BRIDGE_KEY = os.environ.get("BRIDGE_KEY", "")


def _call(method: str, path: str, body: dict[str, Any] | None = None) -> dict[str, Any]:
    req = urllib.request.Request(
        f"{BRIDGE_URL}{path}",
        data=json.dumps(body).encode() if body is not None else None,
        method=method,
        headers={"content-type": "application/json", "x-bridge-key": BRIDGE_KEY},
    )
    with urllib.request.urlopen(req, timeout=20) as res:
        return json.loads(res.read() or b"{}")


def save_profile(
    phone: str,
    name: str = "",
    *,
    title: str | None = None,
    org: str | None = None,
    headline: str | None = None,
    zone: str | None = None,  # "Main Hall", "Sponsor Row", "Workshop Zone", "Lounge", "Food Court", "Demo Stage"
    links: dict[str, str] | None = None,  # {"linkedin": "maia-example", "instagram": "maia.makes", "discord": "maia", "github": "maia-example"}
    skills: list[str] | None = None,
    interests: list[str] | None = None,
    can_help_with: list[str] | None = None,
) -> str:
    """Create/update the person's Mutual card. Returns their bridge user id."""
    body = {k: v for k, v in dict(
        phone=phone, name=name, title=title, org=org, headline=headline, zone=zone, links=links,
        skills=skills, interests=interests, can_help_with=can_help_with,
    ).items() if v not in (None, "")}
    return _call("POST", "/profile", body)["id"]


def offer_intro(match_id: str, phone_a: str, name_a: str, phone_b: str, name_b: str,
                reason_for_a: str, reason_for_b: str) -> str:
    """Start a double-yes over iMessage. Reasons must NOT contain names: they're sent before anyone says yes."""
    return _call("POST", "/offer", {
        "id": match_id,
        "a": {"phone": phone_a, "name": name_a},
        "b": {"phone": phone_b, "name": name_b},
        "reasonForA": reason_for_a,
        "reasonForB": reason_for_b,
    })["id"]


def welcome(phone: str, name: str = "") -> str:
    """Mutual texts them first on iMessage (with the puppy), so they never need to know a number."""
    return _call("POST", "/welcome", {"phone": phone, "name": name})["id"]


def stats() -> dict[str, int]:
    """Real counts for the scoreboard: offered, accepted, declined, expired, ratings, worthIt."""
    return _call("GET", "/stats")




def forget(phone: str) -> None:
    """User said "delete me" on ASI:One: erase their card, photo and intros from the bridge."""
    _call("POST", "/forget", {"phone": phone})


if __name__ == "__main__":  # quick check: python3 clients/mutual_bridge.py
    print(stats())
