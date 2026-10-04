#!/usr/bin/env python3
"""Photon Pup: a networking Tamagotchi mini-game on the FREE-WILi.

  .venv/bin/python pet_game.py            # real badge (screen face + LEDs + voice + buttons) + pixel mirror
  python3 pet_game.py --mock              # no badge: terminal + keyboard (a = GREEN, y, b = BLUE, r = RED, q = quit)

The pup wanders. Match prompts pop up at random: press GREEN in time → DOUBLE YES (+1 social, score +1, rainbow,
the badge says your score). Too slow or RED → "too slow". YELLOW = coffee (+1 energy), BLUE = nap (energy refills),
GREEN while wandering = say hi (just for joy, no points), GRAY = quit.
Social fades over time (the pup gets lonely); at 0 energy it naps until BLUE. LEDs: 4 pink = social, 3 green = energy.

The badge screen shows the pup as an animated text face (OG firmware v024 can't show images); the laptop mirror
(mirror/index.html) shows the same game in pixel art.
"""
from __future__ import annotations

import argparse
import random
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT / "src"))

from photon_fw import device as devices  # noqa: E402
from photon_fw.display import Mirror, compose  # noqa: E402
from photon_fw.input import ButtonTracker  # noqa: E402

MAX_SOCIAL, MAX_ENERGY = 4, 3
PROMPT_S, SOCIAL_FADE_S, ENERGY_FADE_S = 1.6, 25.0, 40.0
G, Y, B, R, GR = (60, 190, 110), (248, 205, 79), (70, 150, 255), (235, 80, 80), (170, 170, 185)
HOME = [(G, "hi"), (Y, "coffee"), (B, "nap"), (GR, "quit")]

# Board screen: ≤ 8 characters per frame (huge font), ASCII only.
FACES = {
    "wander": ["(^o^)", " (^o^)", "  (^o^)", " (^o^)"],
    "lonely": ["(._.)", "(._. )", "( ._.)", "(._.)"],
    "prompt": ["MATCH!", "!(o_o)!", "MATCH!", "!(O_O)!"],
    "yes": ["\\(^o^)/", "<3 <3", "\\(^o^)/", "YES YES!"],
    "miss": ["(-_-)", "too slow", "(-_-)", "(-_-)"],
    "coffee": ["c(^o^)", "c(^O^)", "c(^o^)", "c(^O^)"],
    "nap": ["(-.-)z", "(-.-)zz", "(-.-)zzz", "(-.-)zz"],
}
# Pixel mirror: sprite, title, subtitle, hints
SCENES = {
    "wander": ("idle", "ready to meet?", "catch matches to make your pup happy", HOME),
    "lonely": ("searching", "looking for people...", "your pup misses people", HOME),
    "prompt": ("match", "match found!", "press GREEN for a double yes!", [(G, "YES!"), (R, "skip")]),
    "yes": ("double_yes", "double yes!", "+1 social", []),
    "miss": ("waiting", "too slow...", "next one will come!", []),
    "coffee": ("found", "coffee break!", "+1 energy", []),
    "nap": ("offline", "nap time... zzz", "press BLUE to nap, energy refills", [(B, "nap")]),
}
RAINBOW = [(255, 60, 60), (255, 150, 0), (255, 230, 0), (60, 220, 120), (70, 150, 255), (150, 110, 255), (255, 90, 200)]


class Pup:
    """The game state, pure: feed it buttons and time, read `mode`, `social`, `energy`, `score`."""

    def __init__(self, now: float, rng: random.Random | None = None) -> None:
        self.rng = rng or random.Random()
        self.social, self.energy, self.score = 2, MAX_ENERGY, 0
        self.mode, self.entered = "wander", now
        self.next_prompt = now + self._gap()
        self.social_fade, self.energy_fade = now + SOCIAL_FADE_S, now + ENERGY_FADE_S
        self.events: list[str] = []  # "yes", "coffee", "nap", "prompt", "miss" (for LEDs/voice)

    def _gap(self) -> float:
        return (2.5 if self.social == 0 else 4.0) + self.rng.uniform(0, 5)

    def _go(self, mode: str, now: float) -> None:
        self.mode, self.entered = mode, now
        self.events.append(mode)

    def press(self, button: str, now: float) -> None:
        if self.mode == "prompt" and button == "green":
            self.social = min(MAX_SOCIAL, self.social + 1)
            self.score += 1
            self._go("yes", now)
        elif self.mode == "prompt" and button == "red":
            self._go("miss", now)
        elif self.mode == "wander" and button == "yellow":
            self.energy = min(MAX_ENERGY, self.energy + 1)
            self._go("coffee", now)
        elif self.mode in ("wander", "nap") and button == "blue":
            self.energy = MAX_ENERGY
            self._go("nap", now)
        elif self.mode == "wander" and button == "green":  # say hi: joy, no points
            self.events.append("hi")

    def tick(self, now: float) -> None:
        if now >= self.social_fade:
            self.social_fade = now + SOCIAL_FADE_S
            self.social = max(0, self.social - 1)
        if now >= self.energy_fade:
            self.energy_fade = now + ENERGY_FADE_S
            self.energy = max(0, self.energy - 1)
        age = now - self.entered
        if self.mode == "wander" and self.energy == 0:
            self._go("nap", now)
        elif self.mode == "wander" and now >= self.next_prompt:
            self._go("prompt", now)
        elif self.mode == "prompt" and age > PROMPT_S:
            self._go("miss", now)
        elif (self.mode in ("yes", "coffee", "miss") and age > 1.6) or (self.mode == "nap" and self.energy > 0 and age > 3):
            self.mode, self.entered = "wander", now
            self.next_prompt = now + self._gap()

    def scene(self) -> str:
        return "lonely" if self.mode == "wander" and self.social == 0 else self.mode


def meters(dev, pup: Pup) -> None:
    for i in range(MAX_SOCIAL):
        on = i < pup.social
        dev.dev.gui.set_led_color(i, *((255, 70, 120) if on else (12, 8, 10)), 0, 0) if hasattr(dev, "dev") else None
    for i in range(MAX_ENERGY):
        on = i < pup.energy
        dev.dev.gui.set_led_color(MAX_SOCIAL + i, *((40, 220, 110) if on else (6, 10, 8)), 0, 0) if hasattr(dev, "dev") else None
    if not hasattr(dev, "dev"):
        print(f"  LEDs  social {'#' * pup.social}{'-' * (MAX_SOCIAL - pup.social)}  energy {'#' * pup.energy}{'-' * (MAX_ENERGY - pup.energy)}")


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--mock", action="store_true")
    args = ap.parse_args()

    dev = devices.connect(args.mock)
    mirror = Mirror(ROOT / "mirror")
    tracker = ButtonTracker()
    pup = Pup(time.monotonic())
    print(f"Photon Pup! pixel mirror: {ROOT / 'mirror' / 'index.html'}   (GRAY to quit)")
    dev.say("Hi! I'm your Photon pup")
    meters(dev, pup)
    frame, last_scene, last_meters = 0, "", (pup.social, pup.energy)
    try:
        while True:
            now = time.monotonic()
            presses = dev.presses() if hasattr(dev, "presses") else tracker.update(dev.buttons(), now)
            for button, long in presses:
                if button == "gray":
                    raise KeyboardInterrupt
                pup.press(button, now)
            pup.tick(now)

            for ev in pup.events:  # lights + voice for what just happened
                if ev in ("yes", "hi"):
                    dev.rainbow(RAINBOW)
                    if ev == "yes":
                        dev.say(f"Double yes! Score {pup.score}")
                elif ev == "prompt":
                    dev.leds((255, 190, 20), 1)
                elif ev == "coffee":
                    dev.say("Coffee!")
                elif ev == "nap":
                    dev.leds((40, 30, 90), 2)
                elif ev == "miss":
                    dev.say("Too slow")
            pup.events.clear()

            scene = pup.scene()
            if scene != last_scene and scene in ("wander", "lonely"):
                meters(dev, pup)
            if (pup.social, pup.energy) != last_meters and pup.mode == "wander":
                last_meters = (pup.social, pup.energy)
                meters(dev, pup)
            last_scene = scene

            faces = FACES[scene]
            dev.text(faces[frame % len(faces)])
            sp, title, sub, hints = SCENES[scene]
            bob = [3, 0, -3, 0][frame % 4] if scene not in ("nap", "miss") else 0
            title = f"{title}   score {pup.score}" if scene in ("wander", "lonely") and pup.score else title
            mirror.show(compose(sp, title, sub, hints, bob, heart=scene in ("wander", "prompt", "yes")))
            frame += 1
            time.sleep(0.35)
    except KeyboardInterrupt:
        pass
    finally:
        dev.say(f"Bye! You caught {pup.score} matches")
        dev.leds((0, 0, 0), 0)
        dev.close()


if __name__ == "__main__":
    main()
