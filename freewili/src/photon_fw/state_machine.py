"""Photon companion state machine. Pure and deterministic: no I/O, time is passed in.

  BOOT ─1.5 s→ IDLE ─searching→ SEARCHING ─match_found→ MATCH_FOUND ─YES→ WAITING ─double_yes→ DOUBLE_YES
  DOUBLE_YES ─3 s→ NAVIGATING ─(matched device detected | meeting)→ FOUND ─15 s→ IDLE
  MATCH_FOUND ─NO→ IDLE (decline)        long GREEN: toggle "open to meet"      long RED: go offline
  any ─offline→ OFFLINE ─online / long GREEN→ IDLE

Privacy: `person` (first name, zone) is only stored from a double_yes, and everything about the match
(including the ephemeral match id used for radio proximity) is wiped when the match ends.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from typing import Any

from . import events
from .events import Event


class S(str, Enum):
    BOOT = "BOOT"
    IDLE = "IDLE"
    SEARCHING = "SEARCHING"
    MATCH_FOUND = "MATCH_FOUND"
    WAITING = "WAITING"
    DOUBLE_YES = "DOUBLE_YES"
    NAVIGATING = "NAVIGATING"
    FOUND = "FOUND"
    OFFLINE = "OFFLINE"
    ERROR = "ERROR"


# Timed transitions (seconds)
BOOT_TIME = 1.5
DOUBLE_YES_TIME = 3.0
FOUND_TIME = 15.0
SEARCH_TIMEOUT = 90.0

# FREE-WILi OG buttons (left to right): gray, yellow, green, blue, red
YES, NO, BACK, PREV, NEXT = "green", "red", "gray", "yellow", "blue"
IDLE_PAGES = 3  # 0 mascot, 1 my status, 2 about


@dataclass
class Context:
    open: bool = True  # "open to meet": discoverable for intros
    match_id: str | None = None
    reason: str = ""
    person: dict[str, Any] = field(default_factory=dict)  # only after double yes
    proximity: int = 0  # 0 none, 1 far, 2 near, 3 found (see proximity.Level)
    page: int = 0
    error: str = ""

    def clear_match(self) -> None:
        self.match_id, self.reason, self.person, self.proximity = None, "", {}, 0


class Machine:
    def __init__(self, now: float = 0.0) -> None:
        self.state = S.BOOT
        self.ctx = Context()
        self.entered = now
        self._resume = S.IDLE  # where ERROR returns to

    # -- helpers --------------------------------------------------------------------------------
    def _go(self, state: S, now: float) -> None:
        if state in (S.IDLE, S.OFFLINE):
            self.ctx.clear_match()  # match over: forget it (and its ephemeral id)
            self.ctx.page = 0
        self.state, self.entered = state, now

    def _home(self) -> S:
        return S.IDLE if self.ctx.open else S.OFFLINE

    # -- inputs ---------------------------------------------------------------------------------
    def handle_event(self, ev: Event, now: float) -> list[Event]:
        ev = events.validate_incoming(ev)
        t = ev["type"]
        if self.state == S.ERROR:
            self.state = self._resume  # any valid event means we're connected again
        if t == "offline":
            self.ctx.open = False
            self._go(S.OFFLINE, now)
        elif t == "online":
            self.ctx.open = True
            if self.state == S.OFFLINE:
                self._go(S.IDLE, now)
        elif not self.ctx.open:
            pass  # not discoverable: ignore match traffic
        elif t == "idle":
            if self.state in (S.SEARCHING, S.MATCH_FOUND, S.WAITING):
                self._go(S.IDLE, now)
        elif t == "searching":
            if self.state in (S.IDLE, S.BOOT):
                self._go(S.SEARCHING, now)
        elif t == "match_found":
            if self.state in (S.IDLE, S.SEARCHING, S.BOOT):
                self.ctx.clear_match()
                self.ctx.match_id, self.ctx.reason = ev["matchId"], ev.get("reason", "")
                self._go(S.MATCH_FOUND, now)
        elif t == "waiting":
            if self.state == S.MATCH_FOUND and ev.get("matchId", self.ctx.match_id) == self.ctx.match_id:
                self._go(S.WAITING, now)
        elif t == "double_yes":
            if self.state in (S.MATCH_FOUND, S.WAITING) and ev["matchId"] == self.ctx.match_id:
                p = ev["person"]
                self.ctx.person = {"firstName": p["firstName"], "zone": p.get("zone", "")}
                self._go(S.DOUBLE_YES, now)
        elif t == "meeting":
            if self.state in (S.DOUBLE_YES, S.NAVIGATING):
                self.ctx.proximity = 3
                self._go(S.FOUND, now)
        return []

    def press(self, button: str, long: bool, now: float) -> list[Event]:
        out: list[Event] = []
        if long and button == YES:  # toggle open to meet
            self.ctx.open = not self.ctx.open
            out.append(events.presence(self.ctx.open))
            if not self.ctx.open:
                if self.state == S.MATCH_FOUND and self.ctx.match_id:
                    out.insert(0, events.decline(self.ctx.match_id))
                self._go(S.OFFLINE, now)
            elif self.state == S.OFFLINE:
                self._go(S.IDLE, now)
            return out
        if long and button == NO:  # go offline
            if self.ctx.open:
                if self.state == S.MATCH_FOUND and self.ctx.match_id:
                    out.append(events.decline(self.ctx.match_id))
                self.ctx.open = False
                out.append(events.presence(False))
            self._go(S.OFFLINE, now)
            return out
        if self.state == S.MATCH_FOUND and self.ctx.match_id:
            if button == YES:
                out.append(events.accept(self.ctx.match_id))
                self._go(S.WAITING, now)
            elif button == NO:
                out.append(events.decline(self.ctx.match_id))
                self._go(S.IDLE, now)
        elif self.state == S.IDLE and button in (PREV, NEXT):
            self.ctx.page = (self.ctx.page + (1 if button == NEXT else -1)) % IDLE_PAGES
        elif self.state == S.IDLE and button == BACK:
            self.ctx.page = 0
        elif self.state == S.FOUND and button in (YES, BACK):
            self._go(self._home(), now)  # done: back home now
        return out

    def proximity(self, level: int, now: float) -> list[Event]:
        """Proximity reading while navigating (0 none … 3 found)."""
        if self.state != S.NAVIGATING:
            return []
        self.ctx.proximity = level
        if level >= 3 and self.ctx.match_id:
            match_id = self.ctx.match_id
            self._go(S.FOUND, now)
            return [events.detected(match_id)]
        return []

    def error(self, message: str, now: float) -> None:
        if self.state != S.ERROR:
            self._resume = self.state
        self.ctx.error = message
        self.state = S.ERROR

    def tick(self, now: float) -> list[Event]:
        age = now - self.entered
        if self.state == S.BOOT and age >= BOOT_TIME:
            self._go(self._home(), now)
        elif self.state == S.DOUBLE_YES and age >= DOUBLE_YES_TIME:
            self._go(S.NAVIGATING, now)
        elif self.state == S.FOUND and age >= FOUND_TIME:
            self._go(self._home(), now)
        elif self.state == S.SEARCHING and age >= SEARCH_TIMEOUT:
            self._go(S.IDLE, now)
        return []

    # -- what the hardware may reveal -------------------------------------------------------------
    def visible_person(self) -> dict[str, Any]:
        """Name/zone only after a double yes; never before."""
        return dict(self.ctx.person) if self.state in (S.DOUBLE_YES, S.NAVIGATING, S.FOUND) else {}

    def proximity_active(self) -> bool:
        return self.state == S.NAVIGATING and bool(self.ctx.match_id)
