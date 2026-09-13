import unittest

from unique import unique


class UniqueTest(unittest.TestCase):
    def test_keeps_first_seen_order(self) -> None:
        self.assertEqual(unique(["b", "a", "b", "c"]), ["b", "a", "c"])
