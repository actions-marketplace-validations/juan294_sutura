import unittest

from queue_store import Queue


class QueueTest(unittest.TestCase):
    def test_callers_cannot_mutate_internal_state(self) -> None:
        queue = Queue()
        queue.add("first")
        queue.items().append("smuggled")
        self.assertEqual(queue.items(), ["first"])
