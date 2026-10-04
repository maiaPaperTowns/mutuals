import unittest

import _path  # noqa: F401
from photon_fw.state_machine import BOOT_TIME, DOUBLE_YES_TIME, FOUND_TIME, Machine, S

MATCH = {"type": "match_found", "matchId": "m1", "reason": "also into SpacetimeDB"}
DY = {"type": "double_yes", "matchId": "m1", "person": {"firstName": "Terry", "zone": "Zone B"}}


def booted() -> Machine:
    m = Machine(0)
    m.tick(BOOT_TIME)
    return m


class HappyPath(unittest.TestCase):
    def test_full_flow(self):
        m = booted()
        self.assertEqual(m.state, S.IDLE)
        m.handle_event({"type": "searching"}, 2)
        self.assertEqual(m.state, S.SEARCHING)
        m.handle_event(MATCH, 3)
        self.assertEqual(m.state, S.MATCH_FOUND)
        self.assertEqual(m.press("green", False, 4), [{"type": "accept_match", "matchId": "m1"}])
        self.assertEqual(m.state, S.WAITING)
        m.handle_event(DY, 5)
        self.assertEqual(m.state, S.DOUBLE_YES)
        m.tick(5 + DOUBLE_YES_TIME)
        self.assertEqual(m.state, S.NAVIGATING)
        self.assertTrue(m.proximity_active())
        m.proximity(1, 9)
        self.assertEqual((m.state, m.ctx.proximity), (S.NAVIGATING, 1))
        self.assertEqual(m.proximity(3, 10), [{"type": "matched_device_detected", "matchId": "m1"}])
        self.assertEqual(m.state, S.FOUND)
        m.tick(10 + FOUND_TIME)
        self.assertEqual(m.state, S.IDLE)
        self.assertIsNone(m.ctx.match_id)  # ephemeral id destroyed

    def test_decline_shares_nothing(self):
        m = booted()
        m.handle_event(MATCH, 2)
        self.assertEqual(m.press("red", False, 3), [{"type": "decline_match", "matchId": "m1"}])
        self.assertEqual(m.state, S.IDLE)
        self.assertEqual(m.visible_person(), {})

    def test_meeting_event_also_finds(self):
        m = booted()
        m.handle_event(MATCH, 2); m.press("green", False, 3); m.handle_event(DY, 4)
        m.handle_event({"type": "meeting"}, 5)
        self.assertEqual(m.state, S.FOUND)


class Privacy(unittest.TestCase):
    def test_no_identity_before_double_yes(self):
        m = booted()
        m.handle_event(MATCH, 2)
        self.assertEqual(m.visible_person(), {})
        m.press("green", False, 3)
        self.assertEqual(m.visible_person(), {})
        m.handle_event(DY, 4)
        self.assertEqual(m.visible_person(), {"firstName": "Terry", "zone": "Zone B"})

    def test_double_yes_for_another_match_is_ignored(self):
        m = booted()
        m.handle_event(MATCH, 2); m.press("green", False, 3)
        m.handle_event({**DY, "matchId": "other"}, 4)
        self.assertEqual(m.state, S.WAITING)

    def test_no_proximity_before_double_yes(self):
        m = booted()
        m.handle_event(MATCH, 2)
        self.assertFalse(m.proximity_active())
        self.assertEqual(m.proximity(3, 3), [])


class OpenToMeet(unittest.TestCase):
    def test_long_green_toggles_presence(self):
        m = booted()
        self.assertEqual(m.press("green", True, 2), [{"type": "presence", "open": False}])
        self.assertEqual(m.state, S.OFFLINE)
        m.handle_event(MATCH, 3)  # not discoverable: ignored
        self.assertEqual(m.state, S.OFFLINE)
        self.assertEqual(m.press("green", True, 4), [{"type": "presence", "open": True}])
        self.assertEqual(m.state, S.IDLE)

    def test_long_red_goes_offline_and_declines_pending(self):
        m = booted()
        m.handle_event(MATCH, 2)
        out = m.press("red", True, 3)
        self.assertEqual(out, [{"type": "decline_match", "matchId": "m1"}, {"type": "presence", "open": False}])
        self.assertEqual(m.state, S.OFFLINE)

    def test_offline_event(self):
        m = booted()
        m.handle_event({"type": "offline"}, 2)
        self.assertEqual(m.state, S.OFFLINE)
        m.handle_event({"type": "online"}, 3)
        self.assertEqual(m.state, S.IDLE)


class Misc(unittest.TestCase):
    def test_pages_cycle_in_idle(self):
        m = booted()
        m.press("blue", False, 2); self.assertEqual(m.ctx.page, 1)
        m.press("yellow", False, 3); m.press("yellow", False, 3); self.assertEqual(m.ctx.page, 2)
        m.press("gray", False, 4); self.assertEqual(m.ctx.page, 0)

    def test_error_recovers_on_next_event(self):
        m = booted()
        m.error("can't reach photon", 2)
        self.assertEqual(m.state, S.ERROR)
        m.handle_event({"type": "searching"}, 3)
        self.assertEqual(m.state, S.SEARCHING)

    def test_bad_event_rejected(self):
        with self.assertRaises(ValueError):
            booted().handle_event({"type": "double_yes", "matchId": "m1"}, 2)  # no person


if __name__ == "__main__":
    unittest.main()
