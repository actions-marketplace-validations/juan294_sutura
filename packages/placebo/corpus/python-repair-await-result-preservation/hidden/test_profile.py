import unittest
from profile import fetch_profile

class HiddenProfileTest(unittest.IsolatedAsyncioTestCase):
    async def test_names(self):
        for name in ("Ada", " Grace ", "Linus"):
            self.assertEqual((await fetch_profile(name))["name"], name.strip().upper())
