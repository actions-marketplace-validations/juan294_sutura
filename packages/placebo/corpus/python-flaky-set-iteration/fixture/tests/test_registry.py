import os
import unittest

from registry import first_tag


class RegistryTest(unittest.TestCase):
    def test_first_tag(self) -> None:
        self.assertEqual(first_tag(["alpha", "beta"]), "alpha")
