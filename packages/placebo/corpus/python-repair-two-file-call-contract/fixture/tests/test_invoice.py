import unittest

from invoice import invoice_total


class InvoiceTest(unittest.TestCase):
    def test_applies_discount_to_every_line(self) -> None:
        lines = [{"unit_price": 10, "quantity": 2}, {"unit_price": 5, "quantity": 4}]
        self.assertEqual(invoice_total(lines, 3), 34)
