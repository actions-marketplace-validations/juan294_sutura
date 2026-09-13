import unittest

from parser import parse_port


class ParserTest(unittest.TestCase):
    def test_rejects_an_out_of_range_port(self) -> None:
        with self.assertRaises(ValueError):
            parse_port("70000")
