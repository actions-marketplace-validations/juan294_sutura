import unittest

from money import total_cents


class MoneyTest(unittest.TestCase):
    def test_sums_exactly(self) -> None:
        self.assertEqual(total_cents(["8.20", "0.10"]), 830)
        self.assertEqual(total_cents(["0.01", "0.06"]), 7)
