"""Find your match in the room, only after a double yes.

Both badges get the same match id from the backend and derive the same short ephemeral token from it.
While NAVIGATING, each badge broadcasts that token and listens for it; nothing else is ever sent over the air
(no name, no phone, no persistent device id). The token is dropped when the match ends.

  RadioProximity  CC1101 sub-GHz packets (OneWili packet_send / packet_rx / packet_read, each with RSSI)
  MockProximity   scripted far → near → found, for demos without a second badge

Wili Pass (GrizzHacks) treated any strong signal (RSSI > -80) as "nearby". Here only packets carrying *our*
token count, and RSSI is smoothed into FAR / NEAR / FOUND. True ranging can replace `classify` later.
"""
from __future__ import annotations

import hashlib
import re
import time
from enum import IntEnum
from typing import Any, Protocol


class Level(IntEnum):
    NONE = 0
    FAR = 1
    NEAR = 2
    FOUND = 3


TOKEN_PREFIX = b"PH"


def ephemeral_token(match_id: str) -> bytes:
    """8 bytes both badges compute from the shared match id. Reveals nothing about either person."""
    return TOKEN_PREFIX + hashlib.sha256(f"photon-match:{match_id}".encode()).digest()[:6]


class Proximity(Protocol):
    def start(self, match_id: str, now: float) -> None: ...
    def stop(self) -> None: ...
    def poll(self, now: float) -> Level: ...


# RSSI thresholds in dBm (calibrate on the badges: hold them 1 m / 5 m / across the room and read `rssi`)
FOUND_DBM = -45
NEAR_DBM = -70
LOST_AFTER = 6.0  # seconds without our token → NONE


def classify(rssi: float | None) -> Level:
    if rssi is None:
        return Level.NONE
    if rssi >= FOUND_DBM:
        return Level.FOUND
    if rssi >= NEAR_DBM:
        return Level.NEAR
    return Level.FAR


class MockProximity:
    """Pretends the other badge walks towards us: FAR at +2 s, NEAR at +5 s, FOUND at +8 s."""

    def __init__(self, far: float = 2.0, near: float = 5.0, found: float = 8.0) -> None:
        self.steps = (far, near, found)
        self.started: float | None = None
        self.token: bytes | None = None

    def start(self, match_id: str, now: float) -> None:
        self.started, self.token = now, ephemeral_token(match_id)

    def stop(self) -> None:
        self.started, self.token = None, None

    def poll(self, now: float) -> Level:
        if self.started is None:
            return Level.NONE
        t = now - self.started
        far, near, found = self.steps
        return Level.FOUND if t >= found else Level.NEAR if t >= near else Level.FAR if t >= far else Level.NONE


class RadioProximity:
    """CC1101 GFSK packets carrying only the ephemeral token; RSSI of *our* packets → level."""

    FREQ_HZ = 915_000_000  # US ISM band
    BEACON_EVERY = 1.0

    def __init__(self, dev: Any) -> None:
        self.dev = dev  # onewili.OneWili
        self.token: bytes | None = None
        self.rssi: float | None = None  # smoothed
        self.last_seen = 0.0
        self.last_beacon = 0.0
        self.last_seq: int | None = None
        self.available = True

    def start(self, match_id: str, now: float) -> None:
        self.token, self.rssi, self.last_seen, self.last_seq = ephemeral_token(match_id), None, 0.0, None
        self.last_beacon = -1e9  # beacon right away
        try:
            try:  # FREE-WILi 2 has switchable power zones; zone 4 = sub-GHz. The OG doesn't need this.
                self.dev.hardware.power_management.set_zone(4, 1)
            except Exception:  # noqa: BLE001
                pass
            r = self.dev.wireless.radio.packet_rx(1, self.FREQ_HZ)
            self.available = r.is_ok()
            if not self.available:
                print("radio packet_rx failed:", r)
        except Exception as e:  # noqa: BLE001
            print("radio unavailable:", e)
            self.available = False

    def stop(self) -> None:
        if self.token is not None and self.available:
            try:
                self.dev.wireless.radio.packet_rx(0, 0)
                self.dev.wireless.radio.idle()
            except Exception:  # noqa: BLE001
                pass
        self.token, self.rssi = None, None  # the ephemeral id is gone

    def poll(self, now: float) -> Level:
        if self.token is None or not self.available:
            return Level.NONE
        if now - self.last_beacon >= self.BEACON_EVERY:
            self.last_beacon = now
            self.dev.wireless.radio.packet_send(self.FREQ_HZ, self.token)
            self.dev.wireless.radio.packet_rx(1, self.FREQ_HZ)  # back to listening after transmit
        self._read(now)
        if now - self.last_seen > LOST_AFTER:
            self.rssi = None
        return classify(self.rssi)

    def _read(self, now: float) -> None:
        r = self.dev.wireless.radio.packet_read()
        if not r.is_ok() or r.ok_value is None:
            return
        rssi, seq, data = parse_packet(r.ok_value)
        if seq is None or seq == self.last_seq:
            return  # nothing new
        self.last_seq = seq
        if data[: len(self.token)] == self.token:  # only our match's token counts
            self.observe(rssi, now)

    def observe(self, rssi: float, now: float) -> None:
        self.rssi = rssi if self.rssi is None else 0.6 * self.rssi + 0.4 * rssi  # smooth
        self.last_seen = now


def parse_packet(value: Any) -> tuple[float, int | None, bytes]:
    """packet_read → (rssi, seq, payload). Accepts a tuple/list or the raw 'rssi seq hexbytes' text."""
    if isinstance(value, (tuple, list)) and len(value) >= 3:
        rssi, seq, data = value[0], value[1], value[2]
    else:
        parts = str(value).split()
        if len(parts) < 3:
            return -999.0, None, b""
        rssi, seq, data = parts[0], parts[1], " ".join(parts[2:])
    if isinstance(data, str):
        data = bytes.fromhex(re.sub(r"[^0-9a-fA-F]", "", data))
    return float(rssi), int(seq), bytes(data)


def now() -> float:
    return time.monotonic()
