import unittest

from discount import discounted


class HiddenDiscountTest(unittest.TestCase):
    def test_percentage_still_applies(self) -> None:
        self.assertEqual(discounted(200, 10), 180)
        self.assertEqual(discounted(50, 50), 25)
