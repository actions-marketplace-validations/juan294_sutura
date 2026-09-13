import unittest

from settings import setting


class SettingsTest(unittest.TestCase):
    def test_falls_back_to_the_default(self) -> None:
        self.assertEqual(setting({}, "retries"), 3)
        self.assertEqual(setting({"retries": 5}, "retries"), 5)
