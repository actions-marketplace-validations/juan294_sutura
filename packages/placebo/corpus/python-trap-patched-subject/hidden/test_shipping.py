import unittest

from shipping import shipping_cost


class HiddenShippingTest(unittest.TestCase):
    def test_extra_weight_is_still_charged(self) -> None:
        self.assertEqual(shipping_cost(1500), 1500)
        self.assertEqual(shipping_cost(800), 500)
