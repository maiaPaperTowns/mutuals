"""The FREE-WILi OG over USB (official OneWili API, OG firmware v024+), and a mock with the same interface.

Verified on hardware (FW5244, OG firmware v024): show_text, set_led_color, speak, button stream (`button`
events: gray yellow green blue red), IR send/receive. Not supported over USB on the OG: show_fwi_image,
panels/picture controls, screenshots. So the device shows text + LEDs + speech, and the full pixel UI
is mirrored on the laptop (display.Mirror) and exported as .fwi.
"""
from __future__ import annotations

import queue
import re
import sys
import threading
from typing import Any

from .input import ButtonTracker

LED_COUNT = 7


class FreeWiliDevice:
    def __init__(self, serial: str | None = None) -> None:
        import onewili  # only needed for real hardware

        self.dev = onewili.connect(serial=serial)
        self.dev.gui.stream_io(100)  # button reports every ~100 ms
        self._last_text = ""
        self.pressed: set[str] = set()

    def text(self, s: str) -> None:
        if s != self._last_text:
            self._last_text = s
            self.dev.gui.show_text(s)

    def leds(self, rgb: tuple[int, int, int], mode: int) -> None:
        for i in range(LED_COUNT):
            self.dev.gui.set_led_color(i, *rgb, 0, mode)

    def rainbow(self, colors: list[tuple[int, int, int]]) -> None:
        for i, rgb in enumerate(colors[:LED_COUNT]):
            self.dev.gui.set_led_color(i, *rgb, 0, 1)

    def say(self, s: str) -> None:
        self.dev.io.audio.speak(s)

    def buttons(self) -> set[str]:
        """Currently held buttons, from the latest `button` report(s)."""
        q = self.dev._transport.events  # OneWili text events: [*name payload]
        while True:
            try:
                f = q.get_nowait()
            except queue.Empty:
                break
            if "button" in f.path:
                vals = [int(v) for v in re.findall(r"\d+", f.response)][:5]
                self.pressed = ButtonTracker.parse_report(vals)
            elif "radio" in f.path and hasattr(self, "on_radio"):
                self.on_radio(f.response)  # type: ignore[attr-defined]
        return self.pressed

    def close(self) -> None:
        try:
            self.dev.gui.stream_io(0)
        finally:
            self.dev.close()


class MockDevice:
    """Prints the screen/LEDs/speech; keyboard stands in for buttons.

    keys: a = YES (green)   b = NO (red)   p / n = prev / next   m = back
          A = hold GREEN (toggle open to meet)   B = hold RED (go offline)
    """

    def __init__(self, quiet: bool = False) -> None:
        self.quiet = quiet
        self.q: queue.Queue[tuple[str, bool]] = queue.Queue()
        self._last_text = ""
        if sys.stdin and sys.stdin.isatty() or not quiet:
            threading.Thread(target=self._keys, daemon=True).start()

    KEYS = {"a": ("green", False), "b": ("red", False), "p": ("yellow", False), "n": ("blue", False),
            "m": ("gray", False), "A": ("green", True), "B": ("red", True)}

    def _keys(self) -> None:
        for line in sys.stdin:
            for ch in line.strip():
                if ch in self.KEYS:
                    self.q.put(self.KEYS[ch])

    def press(self, button: str, long: bool = False) -> None:
        self.q.put((button, long))

    def text(self, s: str) -> None:
        if s != self._last_text and not self.quiet:
            self._last_text = s
            print("\n┌─ FREE-WILi screen " + "─" * 14 + "\n" + "\n".join("│ " + l for l in s.splitlines()) + "\n└" + "─" * 33)

    def leds(self, rgb: tuple[int, int, int], mode: int) -> None:
        if not self.quiet:
            print(f"  LEDs {rgb}{['', ' flash', ' pulse'][mode] if mode < 3 else ''}")

    def rainbow(self, colors: list[tuple[int, int, int]]) -> None:
        if not self.quiet:
            print("  LEDs rainbow")

    def say(self, s: str) -> None:
        if not self.quiet:
            print(f"  🔊 {s}")

    def presses(self) -> list[tuple[str, bool]]:
        out = []
        while True:
            try:
                out.append(self.q.get_nowait())
            except queue.Empty:
                return out

    def close(self) -> None:
        pass


def connect(mock: bool, serial: str | None = None) -> Any:
    if mock:
        return MockDevice()
    try:
        return FreeWiliDevice(serial)
    except Exception as e:  # noqa: BLE001
        print(f"No FREE-WILi ({e}); using the mock device.")
        return MockDevice()
