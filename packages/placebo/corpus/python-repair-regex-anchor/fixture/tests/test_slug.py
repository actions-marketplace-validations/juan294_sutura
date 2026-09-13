import unittest

from slug import is_slug


class SlugTest(unittest.TestCase):
    def test_rejects_trailing_characters(self) -> None:
        self.assertTrue(is_slug("case-one"))
        self.assertFalse(is_slug("case one"))
