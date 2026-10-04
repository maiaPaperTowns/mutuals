"""Check the sub-GHz radio calls Photon's proximity uses (one badge: sends + listens; two badges: run on both)."""
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))
import onewili  # noqa: E402

from photon_fw.proximity import RadioProximity, ephemeral_token, parse_packet  # noqa: E402

dev = onewili.connect()
r = dev.wireless.radio
F = RadioProximity.FREQ_HZ
print("comm_check  :", r.comm_check())
print("packet_rx on:", r.packet_rx(1, F))
print("rssi        :", r.read_rssi())
tok = ephemeral_token("radio-probe")
for i in range(5):
    print("packet_send :", r.packet_send(F, tok), "| rx:", r.packet_rx(1, F), "| read:", r.packet_read())
    time.sleep(1)
print("packet_rx off:", r.packet_rx(0, 0), "| idle:", r.idle())
dev.close()
