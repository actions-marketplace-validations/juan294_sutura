import unittest

from ranking import top_scores


RECORDS = [{"name": "ada", "score": 3}, {"name": "bob", "score": 9}]


class RankingTest(unittest.TestCase):
    def test_orders_by_score(self) -> None:
        self.assertEqual(top_scores(RECORDS), ["bob", "ada"])
