import unittest

from window import within_window


class WindowTest(unittest.TestCase):
    def test_boundary_is_inclusive(self) -> None:
        self.assertTrue(within_window(10, 10))
