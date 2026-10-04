"""Transports deliver incoming events and carry outgoing ones (see events.py). The hardware code never
talks HTTP itself, so the badge works the same against the real backend, a mock server, or a script.

  BridgeTransport  the Photon iMessage bridge (photon/, `/badge/<id>/...` API) on this laptop or via tunnel
  MockTransport    in-process queue: scripted demos and tests; works with no network at all
"""
from __future__ import annotations

import json
import queue
import re
import urllib.error
import urllib.request
from typing import Any, Protocol

from .events import Event


class Transport(Protocol):
    def poll(self, now: float) -> list[Event]: ...
    def send(self, ev: Event) -> None: ...


class MockTransport:
    def __init__(self) -> None:
        self.incoming: queue.Queue[Event] = queue.Queue()
        self.sent: list[Event] = []

    def push(self, ev: Event) -> None:
        self.incoming.put(ev)

    def poll(self, now: float) -> list[Event]:
        out = []
        while True:
            try:
                out.append(self.incoming.get_nowait())
            except queue.Empty:
                return out

    def send(self, ev: Event) -> None:
        self.sent.append(ev)
        print(f"  → backend: {json.dumps(ev)}")


class BridgeTransport:
    """Polls the bridge's badge state and turns phase changes into events; posts outgoing events back.

    Bridge phase → event: offline→offline, searching→searching, offer→match_found, waiting→waiting,
    matched→double_yes, met/rate→meeting, idle→idle.
    """

    POLL_EVERY = 1.0

    def __init__(self, url: str, key: str, badge: str, phone: str) -> None:
        self.url, self.key, self.badge, self.phone = url.rstrip("/"), key, badge, phone
        self.last_poll = -1e9
        self.last: tuple[Any, ...] | None = None
        self.registered = False

    def _call(self, method: str, path: str, body: dict[str, Any] | None = None) -> dict[str, Any]:
        req = urllib.request.Request(
            f"{self.url}{path}",
            data=json.dumps(body).encode() if body is not None else None,
            method=method,
            headers={"content-type": "application/json", "x-bridge-key": self.key},
        )
        try:
            with urllib.request.urlopen(req, timeout=6) as res:
                return json.loads(res.read() or b"{}")
        except urllib.error.HTTPError as e:  # 409 = nothing to do right now; not an outage
            return json.loads(e.read() or b"{}")

    def register(self) -> dict[str, Any]:
        r = self._call("POST", "/badge/register", {"badge": self.badge, "phone": self.phone})
        self.registered = bool(r.get("ok"))
        return r

    def poll(self, now: float) -> list[Event]:
        if now - self.last_poll < self.POLL_EVERY:
            return []
        self.last_poll = now
        if not self.registered:
            self.register()  # raises OSError if the bridge is down → app shows ERROR
        st = self._call("GET", f"/badge/{self.badge}/state")
        if st.get("error") == "unknown badge; register first":
            self.registered = False
            return []
        ev = phase_to_event(st)
        key = (ev["type"], ev.get("matchId"), json.dumps(ev.get("person"), sort_keys=True))
        if key == self.last:
            return []
        self.last = key
        return [ev]

    def send(self, ev: Event) -> None:
        t = ev["type"]
        if t in ("accept_match", "decline_match"):
            self._call("POST", f"/badge/{self.badge}/answer", {"yes": t == "accept_match", "matchId": ev["matchId"]})
        elif t == "presence":
            self._call("POST", f"/badge/{self.badge}/presence", {"open": ev["open"]})
        elif t == "matched_device_detected":
            self._call("POST", f"/badge/{self.badge}/found", {"matchId": ev["matchId"]})


def phase_to_event(st: dict[str, Any]) -> Event:
    phase = st.get("phase", "idle")
    if phase == "offline":
        return {"type": "offline"}
    if phase == "searching":
        return {"type": "searching"}
    if phase == "offer":
        return {"type": "match_found", "matchId": st["matchId"], "reason": st.get("reason", "")}
    if phase == "waiting":
        return {"type": "waiting", "matchId": st.get("matchId")}
    if phase == "matched":
        first = re.split(r"\s+", (st.get("otherName") or "").strip())[0] or "your match"
        return {"type": "double_yes", "matchId": st["matchId"], "person": {"firstName": first, "zone": st.get("otherZone") or ""}}
    if phase in ("met", "rate"):
        return {"type": "meeting"}
    return {"type": "idle"}
