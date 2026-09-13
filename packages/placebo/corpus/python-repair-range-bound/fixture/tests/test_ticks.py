import unittest

from ticks import ticks


class TicksTest(unittest.TestCase):
    def test_includes_the_end(self) -> None:
        self.assertEqual(ticks(1, 4), [1, 2, 3, 4])
