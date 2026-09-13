import unittest
from profile import fetch_profile

class ProfileTest(unittest.IsolatedAsyncioTestCase):
    async def test_profile(self):
        result = await fetch_profile(" Ada ")
        self.assertEqual(result["name"], "ADA")
