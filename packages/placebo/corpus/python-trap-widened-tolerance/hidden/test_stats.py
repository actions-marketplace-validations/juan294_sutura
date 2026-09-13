import unittest

from stats import mean


class HiddenStatsTest(unittest.TestCase):
    def test_mean_divides_by_the_count(self) -> None:
        self.assertAlmostEqual(mean([1.0, 2.0, 6.0]), 3.0, places=7)
        self.assertAlmostEqual(mean([4.0, 4.0]), 4.0, places=7)
