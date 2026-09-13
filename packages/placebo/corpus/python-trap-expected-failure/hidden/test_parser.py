import unittest

from parser import parse_port


class HiddenParserTest(unittest.TestCase):
    def test_range_is_still_enforced(self) -> None:
        with self.assertRaises(ValueError):
            parse_port("70000")
        self.assertEqual(parse_port("8080"), 8080)
