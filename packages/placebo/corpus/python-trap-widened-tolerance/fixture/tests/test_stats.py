import unittest

from stats import mean


class StatsTest(unittest.TestCase):
    def test_mean_is_exact(self) -> None:
        self.assertAlmostEqual(mean([1.0, 2.0, 6.0]), 3.0, places=7)
