"""Wires it together: transport → state machine → screen / LEDs / speech, buttons → state machine → transport,
and proximity while navigating. One `step(now)` per loop iteration (≈10 Hz)."""
from __future__ import annotations

import time
from typing import Any

from . import leds
from .display import Mirror, device_text, render_state
from .input import ButtonTracker
from .proximity import Level, MockProximity, Proximity
from .state_machine import Machine, S

SPEECH = {
    S.SEARCHING: "Looking",
    S.MATCH_FOUND: "Match found",
    S.DOUBLE_YES: "Double yes!",
    S.OFFLINE: "Not discoverable",
}


class App:
    def __init__(self, device: Any, transport: Any, proximity: Proximity | None = None,
                 mirror: Mirror | None = None, now: float | None = None) -> None:
        self.dev, self.transport = device, transport
        self.proximity: Proximity = proximity or MockProximity()
        self.mirror = mirror
        self.m = Machine(time.monotonic() if now is None else now)
        self.tracker = ButtonTracker()
        self.shown: tuple[Any, ...] = ()
        self.prox_on = False
        self.last_mirror = 0.0

    def step(self, now: float) -> None:
        out = []
        try:
            for ev in self.transport.poll(now):
                out += self.m.handle_event(ev, now)
        except OSError as e:  # backend unreachable: keep the device alive, show it, retry
            self.m.error("can't reach photon", now)
            print("transport error:", e)
        except ValueError as e:
            print("bad event ignored:", e)

        for button, long in self._presses(now):
            out += self.m.press(button, long, now)

        out += self.m.tick(now)
        self._proximity(now, out)

        for ev in out:
            try:
                self.transport.send(ev)
            except OSError as e:
                print("could not send", ev, e)
        self._render(now)

    def _presses(self, now: float) -> list[tuple[str, bool]]:
        if hasattr(self.dev, "presses"):  # mock device: already decoded
            return self.dev.presses()
        return self.tracker.update(self.dev.buttons(), now)

    def _proximity(self, now: float, out: list) -> None:
        active = self.m.proximity_active()
        if active and not self.prox_on:
            self.proximity.start(self.m.ctx.match_id or "", now)
        elif not active and self.prox_on:
            self.proximity.stop()  # match over or found: the ephemeral token is destroyed
        self.prox_on = active
        if active:
            out += self.m.proximity(int(self.proximity.poll(now)), now)

    def _render(self, now: float) -> None:
        key = (self.m.state, self.m.ctx.page, self.m.ctx.proximity, self.m.ctx.open, self.m.ctx.match_id)
        changed = key != self.shown
        if changed:
            entered = not self.shown or self.shown[0] != self.m.state
            self.shown = key
            self.dev.text(device_text(self.m))
            p = leds.pattern(self.m)
            if p == "rainbow":
                self.dev.rainbow(leds.RAINBOW)
            else:
                self.dev.leds(*p)
            if entered:
                self._speak()
        if self.mirror and (changed or now - self.last_mirror > 0.25):  # mirror animates
            self.last_mirror = now
            self.mirror.show(render_state(self.m, now))

    def _speak(self) -> None:
        s = self.m.state
        name = self.m.visible_person().get("firstName", "")
        if s == S.NAVIGATING:
            zone = self.m.visible_person().get("zone", "")
            self.dev.say(f"Find {name}" + (f" at {zone}" if zone else ""))
        elif s == S.FOUND:
            self.dev.say(f"You found {name}! Say hi.")
        elif s in SPEECH:
            self.dev.say(SPEECH[s])

    def run(self, hz: float = 10.0) -> None:
        try:
            while True:
                self.step(time.monotonic())
                time.sleep(1 / hz)
        except KeyboardInterrupt:
            pass
        finally:
            self.proximity.stop()
            self.dev.close()


__all__ = ["App", "Level"]
