#!/usr/bin/env python3
"""Mutual Badge: a FREE-WILi OG worn on the watch strap becomes Mutual's body in the room.

  intro arrives  → chime + LEDs glow + reason on screen (no names)  → GREEN = yes, RED = not now
  double yes     → both badges glow in the pair's color, speak "Double yes! Find Elena at the Lounge"
  IR high-five   → point badges at each other: each beams its code, the bridge checks it's your match's
                   code → "met in person" is logged → rainbow → "Worth it?" (GREEN / RED)
  idle           → live scoreboard: intros · met · worth it (real counts only)

Runs on the laptop next to the Photon bridge, one process per badge (USB):
  python3 badge.py --phone "+1 555 010 0001"                 # real FREE-WILi (OneWili API)
  python3 badge.py --phone "+1 555 010 0001" --serial XYZ    # pick a board when two are plugged in
  python3 badge.py --phone "+1 555 010 0001" --mock          # no hardware: terminal + keyboard

Mock keys: g = GREEN, r = RED, ir <code> = receive an IR code (the other mock prints its code).
"""
from __future__ import annotations

import argparse
import json
import os
import queue
import re
import sys
import textwrap
import threading
import time
import urllib.error
import urllib.request
from typing import Any, Iterator

# ---------------------------------------------------------------- bridge client

class Bridge:
    def __init__(self, url: str, key: str) -> None:
        self.url, self.key = url.rstrip("/"), key

    def _call(self, method: str, path: str, body: dict[str, Any] | None = None) -> dict[str, Any]:
        req = urllib.request.Request(
            f"{self.url}{path}",
            data=json.dumps(body).encode() if body is not None else None,
            method=method,
            headers={"content-type": "application/json", "x-bridge-key": self.key},
        )
        try:
            with urllib.request.urlopen(req, timeout=8) as res:
                return json.loads(res.read() or b"{}")
        except urllib.error.HTTPError as e:  # 409 "nothing to do right now" is normal
            return json.loads(e.read() or b"{}")

    def register(self, badge: str, phone: str) -> dict[str, Any]:
        return self._call("POST", "/badge/register", {"badge": badge, "phone": phone})

    def state(self, badge: str) -> dict[str, Any]:
        return self._call("GET", f"/badge/{badge}/state")

    def answer(self, badge: str, yes: bool) -> bool:
        return bool(self._call("POST", f"/badge/{badge}/answer", {"yes": yes}).get("ok"))

    def rate(self, badge: str, worth_it: bool) -> bool:
        return bool(self._call("POST", f"/badge/{badge}/rate", {"worthIt": worth_it}).get("ok"))

    def ir(self, badge: str, code: int) -> bool:
        return bool(self._call("POST", f"/badge/{badge}/ir", {"code": code}).get("ok"))


# ---------------------------------------------------------------- hardware

LAVENDER, YELLOW, OFF = (150, 110, 255), (255, 190, 20), (0, 0, 0)
RAINBOW = [(255, 60, 60), (255, 150, 0), (255, 230, 0), (60, 220, 120), (70, 150, 255), (150, 110, 255), (255, 90, 200)]
LED_COUNT = 7  # FREE-WILi OG: 7 RGB LEDs


class FreeWili:
    """FREE-WILi OG over USB with the official OneWili API (pip install from github.com/freewili/onewili)."""

    # LED modes from OneWili enums.owLEDManagerLEDMode
    SOLID, FLASH, PULSE = 0, 1, 2
    LED_DURATION = 0  # TODO(on device): confirm units; 0 = hold

    def __init__(self, serial: str | None, debug: bool) -> None:
        import onewili  # imported here so --mock works without the package

        self.dev = onewili.connect(serial=serial)
        self.debug = debug
        self.dev.gui.stream_io(100)  # button reports, ~100 ms (OneWili "Stream Buttons")
        self.dev.wireless.ir.enable_ir_stream(1)  # deliver received IR codes as `irrx` events
        self._pressed: set[str] = set()

    def text(self, s: str) -> None:
        self.dev.gui.show_text(s)

    def leds(self, rgb: tuple[int, int, int], mode: int = SOLID) -> None:
        for i in range(LED_COUNT):
            self.dev.gui.set_led_color(i, *rgb, self.LED_DURATION, mode)

    def rainbow(self) -> None:
        for i, rgb in enumerate(RAINBOW):
            self.dev.gui.set_led_color(i, *rgb, self.LED_DURATION, self.FLASH)

    def say(self, s: str) -> None:
        self.dev.io.audio.speak(s)

    def send_ir(self, code: int) -> None:
        self.dev.wireless.ir.send_ir_data(code)

    def events(self) -> Iterator[tuple[str, Any]]:
        """("button", "green"|"red"|...) on press, ("ir", code) on receive."""
        q = self.dev._transport.events  # OneWili text events: [*<name> payload] frames
        while True:
            try:
                f = q.get_nowait()
            except queue.Empty:
                return
            if self.debug:
                print("event:", f.path, f.response)
            if "irrx" in f.path:
                m = re.search(r"(?:0x)?([0-9a-fA-F]+)", f.response)
                if m:
                    yield "ir", int(m.group(1), 16)
            elif "button" in f.path:
                # payload: gray yellow green blue red (1 = pressed); report presses on the way down
                vals = [int(v) for v in re.findall(r"\d+", f.response)][:5]
                down = {n for n, v in zip(["gray", "yellow", "green", "blue", "red"], vals) if v}
                for name in down - self._pressed:
                    yield "button", name
                self._pressed = down


class Mock:
    """Same interface as FreeWili, printed to the terminal; keyboard stands in for buttons and IR."""

    def __init__(self) -> None:
        self.q: queue.Queue[tuple[str, Any]] = queue.Queue()
        threading.Thread(target=self._keys, daemon=True).start()

    def _keys(self) -> None:
        for line in sys.stdin:
            w = line.strip().lower().split()
            if not w:
                continue
            if w[0] in ("g", "green"):
                self.q.put(("button", "green"))
            elif w[0] in ("r", "red"):
                self.q.put(("button", "red"))
            elif w[0] == "ir" and len(w) > 1 and w[1].isdigit():
                self.q.put(("ir", int(w[1])))

    def text(self, s: str) -> None:
        print("\n┌─ screen " + "─" * 22 + "\n" + "\n".join("│ " + l for l in s.splitlines()) + "\n└" + "─" * 31)

    def leds(self, rgb: tuple[int, int, int], mode: int = 0) -> None:
        print(f"  LEDs: rgb{rgb}{' (pulse)' if mode == FreeWili.PULSE else ''}")

    def rainbow(self) -> None:
        print("  LEDs: 🌈 rainbow")

    def say(self, s: str) -> None:
        print(f"  🔊 \"{s}\"")

    def send_ir(self, code: int) -> None:
        pass  # mock: printed once when matched instead of every beam

    def events(self) -> Iterator[tuple[str, Any]]:
        while True:
            try:
                yield self.q.get_nowait()
            except queue.Empty:
                return


# ---------------------------------------------------------------- badge logic

def wrap(s: str, width: int = 26) -> str:
    return "\n".join(textwrap.wrap(s, width))


def render(hw: Any, st: dict[str, Any], mock: bool) -> None:
    phase = st.get("phase", "idle")
    s = st.get("stats", {})
    if phase == "idle":
        pct = f"{round(100 * s.get('worthIt', 0) / s['ratings'])}%" if s.get("ratings") else "-"
        hw.text(f"MUTUAL\npeople find people\n\nintros  {s.get('offered', 0)}\nmet     {s.get('met', 0)}\nworth it {pct}")
        hw.leds((30, 20, 60), FreeWili.PULSE)
    elif phase == "offer":
        hw.leds(LAVENDER, FreeWili.PULSE)
        hw.say("Someone nearby wants to meet")
        hw.text(f"SOMEONE NEARBY!\n\n{wrap(st.get('reason', ''))}\n\nGREEN = yes\nRED = not now")
    elif phase == "waiting":
        hw.leds(LAVENDER)
        hw.text("You said yes!\n\nWaiting on them...\n\nNo names until\nyou both say yes")
    elif phase == "matched":
        color = tuple(st["color"]["rgb"])
        name, zone = st.get("otherName", ""), st.get("otherZone")
        hw.leds(color, FreeWili.PULSE)
        hw.say(f"Double yes! Find {name}" + (f" at the {zone}" if zone else ""))
        hw.text(f"DOUBLE YES!\n\nMeet {name}\n{zone or ''}\nLook for {st['color']['name']} lights\n\nPoint badges together\nto high-five")
        if mock:
            print(f"  (mock) my IR code: {st['myIrCode']}  → in the other badge type: ir {st['myIrCode']}")
    elif phase == "rate":
        hw.leds(YELLOW)
        hw.text("Worth it?\n\nGREEN = yes\nRED = no")
    elif phase == "met":
        hw.rainbow()
        hw.text(f"You met\n{st.get('otherName', '')}!\n\nThanks for being\na good human")


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--phone", required=True, help="the wearer's phone (same as in Photon → Users)")
    ap.add_argument("--serial", help="FREE-WILi serial, when more than one board is plugged in")
    ap.add_argument("--badge", help="badge id (default: serial, or 'mock-<phone>')")
    ap.add_argument("--bridge", default=os.environ.get("BRIDGE_URL", "http://localhost:8787"))
    ap.add_argument("--key", default=os.environ.get("BRIDGE_KEY", ""))
    ap.add_argument("--mock", action="store_true", help="no hardware: print to the terminal, keys for buttons")
    ap.add_argument("--debug", action="store_true", help="print raw FREE-WILi events (for tuning on device)")
    args = ap.parse_args()

    hw: Any = Mock() if args.mock else FreeWili(args.serial, args.debug)
    digits = re.sub(r"\D", "", args.phone)
    badge = args.badge or args.serial or f"mock-{digits}"
    bridge = Bridge(args.bridge, args.key)
    who = bridge.register(badge, args.phone)
    if not who.get("ok"):
        sys.exit(f"bridge said: {who}")
    print(f"Mutual badge '{badge}' for {who.get('name') or args.phone}. Ctrl+C to stop.")

    shown: tuple[Any, ...] = ()
    st: dict[str, Any] = {"phase": "idle", "stats": {}}
    last_poll = last_beam = 0.0
    while True:
        now = time.monotonic()
        if now - last_poll > 1.0:
            last_poll = now
            try:
                st = bridge.state(badge)
            except OSError as e:
                print("bridge unreachable:", e)
                time.sleep(2)
                continue
            key = (st.get("phase"), st.get("matchId"), st.get("phase") == "idle" and json.dumps(st.get("stats")))
            if key != shown:
                shown = key
                render(hw, st, args.mock)
                if st.get("phase") == "met":
                    hw.say(f"Nice to meet you, {st.get('otherName', '')}!")

        for kind, value in hw.events():
            phase = st.get("phase")
            if kind == "button" and value in ("green", "red"):
                yes = value == "green"
                if phase == "offer":
                    bridge.answer(badge, yes)
                elif phase == "rate":
                    bridge.rate(badge, yes)
                last_poll = 0  # refresh now
            elif kind == "ir" and phase == "matched":
                if bridge.ir(badge, int(value)):
                    print("🤝 high-five confirmed: met in person")
                    last_poll = 0

        # While matched, beam our code so the partner's badge can catch it.
        if st.get("phase") == "matched" and st.get("myIrCode") is not None and now - last_beam > 1.5:
            last_beam = now
            hw.send_ir(int(st["myIrCode"]))
        time.sleep(0.1)


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        pass
