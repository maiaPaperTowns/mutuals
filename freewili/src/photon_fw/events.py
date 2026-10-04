"""The event contract between the FREE-WILi companion and the Photon backend (plain JSON dicts).

Incoming (backend → device):
  {"type": "searching"}
  {"type": "match_found", "matchId": "...", "reason": "also working with SpacetimeDB"}
  {"type": "waiting"}
  {"type": "double_yes", "matchId": "...", "person": {"firstName": "...", "zone": "..."}}
  {"type": "meeting"}            the backend confirmed the two met (e.g. the other badge saw us)
  {"type": "offline"} / {"type": "online"}
  {"type": "idle"}               nothing in progress (intro declined or expired)

Outgoing (device → backend):
  {"type": "accept_match", "matchId": "..."}
  {"type": "decline_match", "matchId": "..."}
  {"type": "presence", "open": true}
  {"type": "matched_device_detected", "matchId": "..."}
"""
from __future__ import annotations

from typing import Any

INCOMING = {"searching", "match_found", "waiting", "double_yes", "meeting", "offline", "online", "idle"}
OUTGOING = {"accept_match", "decline_match", "presence", "matched_device_detected"}

Event = dict[str, Any]


def validate_incoming(ev: Event) -> Event:
    t = ev.get("type")
    if t not in INCOMING:
        raise ValueError(f"unknown incoming event {t!r}")
    if t in ("match_found", "double_yes") and not ev.get("matchId"):
        raise ValueError(f"{t} needs a matchId")
    if t == "double_yes":
        person = ev.get("person") or {}
        if not person.get("firstName"):
            raise ValueError("double_yes needs person.firstName")
    return ev


def accept(match_id: str) -> Event:
    return {"type": "accept_match", "matchId": match_id}


def decline(match_id: str) -> Event:
    return {"type": "decline_match", "matchId": match_id}


def presence(open_: bool) -> Event:
    return {"type": "presence", "open": open_}


def detected(match_id: str) -> Event:
    return {"type": "matched_device_detected", "matchId": match_id}
