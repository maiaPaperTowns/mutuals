#!/usr/bin/env python3
"""Photon on FREE-WILi.

  .venv/bin/python main.py --phone "+1 555 010 0001"            # real badge + Photon bridge (localhost:8787)
  .venv/bin/python main.py --phone "+1 ..." --mock-device       # no badge: terminal screen + keyboard
  .venv/bin/python main.py --phone "+1 ..." --radio             # real radio proximity (two badges)
  python3 mock/demo_sequence.py                                 # 60-second scripted demo, works offline

The pixel UI is mirrored live at mirror/index.html (open it in a browser next to the badge).
"""
import argparse
import os
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent / "src"))

from photon_fw import device as devices  # noqa: E402
from photon_fw.app import App  # noqa: E402
from photon_fw.display import Mirror  # noqa: E402
from photon_fw.proximity import MockProximity, RadioProximity  # noqa: E402
from photon_fw.transport import BridgeTransport  # noqa: E402


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--phone", required=True, help="the wearer's phone number (as in Photon → Users)")
    ap.add_argument("--bridge", default=os.environ.get("BRIDGE_URL", "http://localhost:8787"))
    ap.add_argument("--key", default=os.environ.get("BRIDGE_KEY", ""))
    ap.add_argument("--serial", help="FREE-WILi serial when two badges are plugged in")
    ap.add_argument("--mock-device", action="store_true", help="no hardware")
    ap.add_argument("--radio", action="store_true", help="sub-GHz radio proximity (needs two badges)")
    ap.add_argument("--mirror", default=str(Path(__file__).parent / "mirror"))
    args = ap.parse_args()

    dev = devices.connect(args.mock_device, args.serial)
    badge = args.serial or f"badge-{re.sub(r'[^0-9]', '', args.phone)}"
    transport = BridgeTransport(args.bridge, args.key, badge, args.phone)
    prox = RadioProximity(dev.dev) if args.radio and hasattr(dev, "dev") else MockProximity()
    mirror = Mirror(args.mirror)
    print(f"photon badge {badge} → {args.bridge}   pixel UI: {Path(args.mirror) / 'index.html'}")
    App(dev, transport, prox, mirror).run()


if __name__ == "__main__":
    main()
