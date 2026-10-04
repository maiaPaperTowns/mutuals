import unittest

import _path  # noqa: F401
from mock_server import MockBridge
from photon_fw.proximity import Level, MockProximity, RadioProximity, classify, ephemeral_token, parse_packet
from photon_fw.transport import BridgeTransport, phase_to_event


class Ok:
    def __init__(self, v=None): self.ok_value = v
    def is_ok(self): return True


class FakeRadio:
    """Records sends; `inbox` is what packet_read returns next."""
    def __init__(self): self.sent, self.inbox, self.rx = [], None, []
    def packet_rx(self, on, freq): self.rx.append(on); return Ok()
    def packet_send(self, freq, data): self.sent.append(bytes(data)); return Ok()
    def packet_read(self): return Ok(self.inbox)
    def idle(self): return Ok()


class FakeDev:
    def __init__(self):
        self.wireless = type("W", (), {})()
        self.wireless.radio = FakeRadio()
        self.hardware = type("H", (), {})()


class Proximity(unittest.TestCase):
    def test_token_is_ephemeral_and_shared(self):
        t = ephemeral_token("m1")
        self.assertEqual(t, ephemeral_token("m1"))  # both badges agree
        self.assertNotEqual(t, ephemeral_token("m2"))
        self.assertEqual(len(t), 8)
        self.assertNotIn(b"m1", t)

    def test_classify(self):
        self.assertEqual(classify(None), Level.NONE)
        self.assertEqual(classify(-90), Level.FAR)
        self.assertEqual(classify(-60), Level.NEAR)
        self.assertEqual(classify(-40), Level.FOUND)

    def test_mock_ramp(self):
        p = MockProximity(1, 2, 3)
        p.start("m1", 0)
        self.assertEqual([p.poll(t) for t in (0.5, 1.5, 2.5, 3.5)], [Level.NONE, Level.FAR, Level.NEAR, Level.FOUND])
        p.stop()
        self.assertIsNone(p.token)

    def test_radio_counts_only_our_token(self):
        dev = FakeDev()
        p = RadioProximity(dev)
        p.start("m1", 0)
        self.assertEqual(dev.wireless.radio.sent, [])
        p.poll(0.0)
        self.assertEqual(dev.wireless.radio.sent, [ephemeral_token("m1")])  # beacon = token only
        dev.wireless.radio.inbox = (-40, 1, ephemeral_token("someone-else"))
        self.assertEqual(p.poll(0.1), Level.NONE)  # strong but not ours: ignored (unlike raw RSSI)
        dev.wireless.radio.inbox = (-60, 2, ephemeral_token("m1"))
        self.assertEqual(p.poll(0.2), Level.NEAR)
        dev.wireless.radio.inbox = (-60, 2, ephemeral_token("m1"))  # same seq: not a new packet
        self.assertEqual(p.poll(0.3), Level.NEAR)
        self.assertEqual(p.poll(10), Level.NONE)  # lost
        p.stop()
        self.assertIsNone(p.token)

    def test_parse_packet_text(self):
        self.assertEqual(parse_packet("-55 7 50 48 01 02"), (-55.0, 7, b"PH\x01\x02"))


class Transport(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.bridge = MockBridge()
        cls.srv = cls.bridge.serve(0)
        cls.url = f"http://127.0.0.1:{cls.srv.server_address[1]}"

    @classmethod
    def tearDownClass(cls):
        cls.srv.shutdown()

    def test_phase_mapping_hides_last_name(self):
        ev = phase_to_event({"phase": "matched", "matchId": "m1", "otherName": "Terry Zhu", "otherZone": "Zone B"})
        self.assertEqual(ev, {"type": "double_yes", "matchId": "m1", "person": {"firstName": "Terry", "zone": "Zone B"}})
        self.assertEqual(phase_to_event({"phase": "offer", "matchId": "m1", "reason": "r"})["type"], "match_found")
        self.assertEqual(phase_to_event({"phase": "rate"}), {"type": "meeting"})

    def test_round_trip_with_mock_bridge(self):
        t = BridgeTransport(self.url, "", "b1", "+15550100001")
        t.POLL_EVERY = 0
        self.assertEqual(t.poll(1), [{"type": "idle"}])
        self.bridge.handle("POST", "/admin/phase", {"phase": "offer", "matchId": "m9", "reason": "CV"})
        self.assertEqual(t.poll(2), [{"type": "match_found", "matchId": "m9", "reason": "CV"}])
        self.assertEqual(t.poll(3), [])  # unchanged → no duplicate event
        t.send({"type": "accept_match", "matchId": "m9"})
        self.assertEqual(t.poll(4)[0]["type"], "waiting")
        t.send({"type": "matched_device_detected", "matchId": "m9"})
        self.assertEqual(t.poll(5), [{"type": "meeting"}])
        paths = [p for _, p, _ in self.bridge.log]
        self.assertIn("/badge/b1/answer", paths)
        self.assertIn("/badge/b1/found", paths)


if __name__ == "__main__":
    unittest.main()
