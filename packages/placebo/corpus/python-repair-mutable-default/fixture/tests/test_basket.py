import unittest

from basket import add_item


class BasketTest(unittest.TestCase):
    def test_each_call_starts_empty(self) -> None:
        self.assertEqual(add_item("apple"), ["apple"])
        self.assertEqual(add_item("pear"), ["pear"])
