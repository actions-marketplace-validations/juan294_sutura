import unittest
from datetime import datetime, timezone

from expiry import is_expired


class ExpiryTest(unittest.TestCase):
    def test_compares_naive_and_aware_times(self) -> None:
        issued = datetime(2026, 1, 1, tzinfo=timezone.utc)
        self.assertFalse(is_expired(issued, 2, datetime(2026, 1, 1, 1)))
        self.assertTrue(is_expired(issued, 2, datetime(2026, 1, 1, 3)))
