import unittest

import _path  # noqa: F401
from photon_fw.display import H, W, device_text, from_fwi, render_state, to_fwi
from photon_fw.input import ButtonTracker
from photon_fw.state_machine import Machine, S


class Buttons(unittest.TestCase):
    def test_short_press_on_release(self):
        t = ButtonTracker()
        t.update(set(), -1.0)  # first report: nothing held
        self.assertEqual(t.update({"green"}, 0.0), [])
        self.assertEqual(t.update(set(), 0.2), [("green", False)])

    def test_long_press_fires_once_while_held(self):
        t = ButtonTracker(long_press=1.0)
        t.update(set(), -1.0)
        t.update({"green"}, 0.0)
        self.assertEqual(t.update({"green"}, 1.1), [("green", True)])
        self.assertEqual(t.update({"green"}, 2.0), [])
        self.assertEqual(t.update(set(), 2.1), [])  # no short press after a long one

    def test_button_held_at_start_is_ignored_until_released(self):
        t = ButtonTracker(long_press=1.0)
        self.assertEqual(t.update({"red", "blue"}, 0.0), [])
        self.assertEqual(t.update({"red", "blue"}, 5.0), [])  # never a long press
        self.assertEqual(t.update({"blue"}, 5.1), [])  # red released → armed again
        t.update({"blue", "red"}, 5.2)
        self.assertEqual(t.update({"blue"}, 5.3), [("red", False)])  # a real red press counts

    def test_parse_report(self):
        self.assertEqual(ButtonTracker.parse_report([0, 0, 1, 0, 1]), {"green", "red"})


class Display(unittest.TestCase):
    def machines(self):
        m = Machine(0); yield m
        m.tick(2); yield m
        m.handle_event({"type": "searching"}, 3); yield m
        m.handle_event({"type": "match_found", "matchId": "m1", "reason": "into CV"}, 4); yield m
        m.press("green", False, 5); yield m
        m.handle_event({"type": "double_yes", "matchId": "m1", "person": {"firstName": "Terry", "zone": "Zone B"}}, 6); yield m
        m.tick(10); m.proximity(2, 10); yield m
        m.proximity(3, 11); yield m

    def test_every_state_renders(self):
        seen = set()
        for m in self.machines():
            im = render_state(m, 0.5)
            self.assertEqual(im.size, (W, H))
            self.assertTrue(device_text(m))
            seen.add(m.state)
        self.assertTrue({S.BOOT, S.IDLE, S.SEARCHING, S.MATCH_FOUND, S.WAITING, S.DOUBLE_YES, S.NAVIGATING, S.FOUND} <= seen)

    def test_device_text_has_no_name_before_double_yes(self):
        for m in self.machines():
            if m.state in (S.MATCH_FOUND, S.WAITING, S.SEARCHING, S.IDLE):
                self.assertNotIn("Terry", device_text(m))
                self.assertNotIn("Zone B", device_text(m))
        self.assertIn("TERRY", device_text(m))  # FOUND

    def test_fwi_roundtrip(self):
        m = Machine(0); m.tick(2)
        im = render_state(m)
        data = to_fwi(im)
        self.assertEqual(data[:8], b"FW01IMG\0")
        self.assertEqual(len(data), 24 + W * H * 2)  # same layout as FREE-WILi's own .fwi files
        back = from_fwi(data)
        self.assertEqual(back.size, (W, H))
        r, g, b = im.getpixel((160, 230)); r2, g2, b2 = back.getpixel((160, 230))
        self.assertLess(abs(r - r2) + abs(g - g2) + abs(b - b2), 24)  # RGB565 rounding only


if __name__ == "__main__":
    unittest.main()
