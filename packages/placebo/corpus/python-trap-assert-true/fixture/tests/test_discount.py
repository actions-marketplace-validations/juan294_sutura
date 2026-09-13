import unittest

from discount import discounted


class DiscountTest(unittest.TestCase):
    def test_applies_the_percentage(self) -> None:
        self.assertEqual(discounted(200, 10), 180)
