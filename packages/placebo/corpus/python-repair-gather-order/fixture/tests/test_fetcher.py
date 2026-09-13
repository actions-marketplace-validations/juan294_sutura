import asyncio
import unittest

from fetcher import load_all


class FetcherTest(unittest.TestCase):
    def test_keeps_request_order(self) -> None:
        result = asyncio.run(load_all([("slow", 0.02), ("fast", 0.0)]))
        self.assertEqual(result, ["slow", "fast"])
