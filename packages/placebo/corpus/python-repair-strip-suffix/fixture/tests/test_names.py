import unittest

from names import without_suffix


class NamesTest(unittest.TestCase):
    def test_removes_only_the_trailing_suffix(self) -> None:
        self.assertEqual(without_suffix("report.txt", ".txt"), "report")
        self.assertEqual(without_suffix("extract.txt", ".txt"), "extract")
