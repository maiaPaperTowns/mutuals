import random
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import _path  # noqa: F401,E402
from pet_game import FACES, MAX_ENERGY, Pup  # noqa: E402


class PupGame(unittest.TestCase):
    def pup(self):
        return Pup(0.0, random.Random(1))

    def test_catching_a_match(self):
        p = self.pup()
        p.tick(p.next_prompt)
        self.assertEqual(p.mode, "prompt")
        p.press("green", p.next_prompt + 0.5)
        self.assertEqual((p.mode, p.score, p.social), ("yes", 1, 3))

    def test_too_slow(self):
        p = self.pup()
        t = p.next_prompt
        p.tick(t); p.tick(t + 2)
        self.assertEqual((p.mode, p.score), ("miss", 0))

    def test_saying_hi_gives_no_points(self):
        p = self.pup()
        p.press("green", 0.1)
        self.assertEqual((p.mode, p.score, p.social), ("wander", 0, 2))

    def test_coffee_and_nap(self):
        p = self.pup()
        p.energy = 1
        p.press("yellow", 0.1)
        self.assertEqual((p.mode, p.energy), ("coffee", 2))
        p.tick(2); p.press("blue", 2.1)
        self.assertEqual((p.mode, p.energy), ("nap", MAX_ENERGY))

    def test_lonely_then_sleepy(self):
        p = self.pup()
        p.next_prompt = 1e9
        for t in range(0, 200, 5):
            p.tick(float(t))
        self.assertEqual(p.social, 0)
        self.assertEqual(p.mode, "nap")  # out of energy

    def test_faces_fit_the_board(self):
        for frames in FACES.values():
            for f in frames:
                self.assertLessEqual(len(f), 8, f)
                f.encode("ascii")


if __name__ == "__main__":
    unittest.main()
