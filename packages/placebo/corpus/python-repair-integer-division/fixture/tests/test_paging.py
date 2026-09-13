import unittest

from paging import page_index


class PagingTest(unittest.TestCase):
    def test_index_is_an_integer(self) -> None:
        self.assertEqual(page_index(25, 10), 2)
        self.assertIsInstance(page_index(25, 10), int)
