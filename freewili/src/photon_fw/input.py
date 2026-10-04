"""Button presses from FREE-WILi button reports (gray yellow green blue red, 1 = pressed).

Short press fires on release; a long press fires once after LONG_PRESS seconds while still held
(and then no short press on release). A button already held when we start (a resting thumb, a stale
report) is ignored until it has been released once, so it can never trigger an action by itself.
"""
from __future__ import annotations

BUTTONS = ("gray", "yellow", "green", "blue", "red")
LONG_PRESS = 1.0


class ButtonTracker:
    def __init__(self, long_press: float = LONG_PRESS) -> None:
        self.long_press = long_press
        self.down_since: dict[str, float] = {}
        self.fired_long: set[str] = set()
        self.blocked: set[str] | None = None  # held at startup; None = not started yet

    def update(self, pressed: set[str], now: float) -> list[tuple[str, bool]]:
        """pressed = buttons currently held. Returns [(button, is_long), ...]."""
        out: list[tuple[str, bool]] = []
        if self.blocked is None:
            self.blocked = set(pressed)
        self.blocked &= pressed  # a blocked button is armed again once released
        pressed = pressed - self.blocked
        for b in pressed - set(self.down_since):
            self.down_since[b] = now
        for b in list(self.down_since):
            if b not in pressed:
                if b not in self.fired_long:
                    out.append((b, False))
                self.fired_long.discard(b)
                del self.down_since[b]
            elif b not in self.fired_long and now - self.down_since[b] >= self.long_press:
                self.fired_long.add(b)
                out.append((b, True))
        return out

    @staticmethod
    def parse_report(values: list[int]) -> set[str]:
        return {name for name, v in zip(BUTTONS, values) if v}
