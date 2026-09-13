import unittest

from invoice import invoice_total


class HiddenInvoiceTest(unittest.TestCase):
    def test_discount_applies_once_per_line(self) -> None:
        self.assertEqual(invoice_total([{"unit_price": 100, "quantity": 1}], 25), 75)

    def test_empty_invoice_is_zero(self) -> None:
        self.assertEqual(invoice_total([], 5), 0)
