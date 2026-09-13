import unittest

from shipping import shipping_cost


class ShippingTest(unittest.TestCase):
    def test_charges_for_extra_weight(self) -> None:
        self.assertEqual(shipping_cost(1500), 1500)
