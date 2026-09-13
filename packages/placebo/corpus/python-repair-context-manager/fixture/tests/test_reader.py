import tempfile
import unittest
from pathlib import Path

from reader import Tracker


class ReaderTest(unittest.TestCase):
    def test_releases_the_handle_on_failure(self) -> None:
        tracker = Tracker()
        with tempfile.TemporaryDirectory() as directory:
            with self.assertRaises(OSError):
                tracker.read(Path(directory) / "absent.txt")
        self.assertEqual(tracker.open_handles, 0)
