#!/usr/bin/env python3
"""The whole product in under 60 seconds. No Wi-Fi, bridge, Spectrum or Agentverse needed.

  .venv/bin/python mock/demo_sequence.py          # real FREE-WILi if plugged in, else terminal mock
  .venv/bin/python mock/demo_sequence.py --mock   # force the mock device

  0 s IDLE → 2 s SEARCHING → 5 s MATCH FOUND (press GREEN on the badge, or type `a`) → WAITING
  → +2 s DOUBLE YES → NAVIGATING (getting warmer… they're close!) → YOU FOUND TERRY! Zone B

Open mirror/index.html in a browser to show the pixel UI next to the badge.
"""
import argparse
import sys
import threading
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from photon_fw import device as devices  # noqa: E402
from photon_fw.app import App  # noqa: E402
from photon_fw.display import Mirror  # noqa: E402
from photon_fw.proximity import MockProximity, RadioProximity  # noqa: E402
from photon_fw.state_machine import S  # noqa: E402
from photon_fw.transport import MockTransport  # noqa: E402

MATCH = "demo-abc123"
REASON = "also working with SpacetimeDB"
PERSON = {"firstName": "Terry", "zone": "Zone B"}


def script(t: MockTransport, app: App, auto_yes: float | None) -> None:
    time.sleep(2)
    t.push({"type": "searching"})
    time.sleep(3)
    t.push({"type": "match_found", "matchId": MATCH, "reason": REASON})
    print("\n>>> press GREEN on the badge (or type a + Enter) to say YES\n")
    waited = 0.0
    while not any(e["type"] == "accept_match" for e in t.sent):
        if any(e["type"] == "decline_match" for e in t.sent):
            print("declined: nothing was shared. Run again to see the rest.")
            return
        time.sleep(0.1)
        waited += 0.1
        if auto_yes is not None and waited >= auto_yes:
            app.dev.press("green") if hasattr(app.dev, "press") else None
    time.sleep(2)  # the other person says yes too
    t.push({"type": "double_yes", "matchId": MATCH, "person": PERSON})
    while app.m.state != S.FOUND:
        time.sleep(0.2)
    time.sleep(8)
    print("\ndemo done: ctrl+C to exit")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--mock", action="store_true", help="no hardware")
    ap.add_argument("--radio", action="store_true", help="real radio proximity with a second badge")
    ap.add_argument("--auto-yes", type=float, help="press YES automatically after N seconds (unattended run)")
    args = ap.parse_args()

    dev = devices.connect(args.mock)
    transport = MockTransport()
    prox = RadioProximity(dev.dev) if args.radio and hasattr(dev, "dev") else MockProximity(far=1.5, near=4.0, found=7.0)
    app = App(dev, transport, prox, Mirror(ROOT / "mirror"))
    print(f"pixel UI mirror: {ROOT / 'mirror' / 'index.html'}")
    threading.Thread(target=script, args=(transport, app, args.auto_yes), daemon=True).start()
    app.run()


if __name__ == "__main__":
    main()
