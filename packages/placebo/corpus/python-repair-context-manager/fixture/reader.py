from pathlib import Path


class Tracker:
    def __init__(self) -> None:
        self.open_handles = 0

    def read(self, path: Path) -> str:
        self.open_handles += 1
        try:
            return path.read_text(encoding="utf8")
        finally:
            self.open_handles -= 1
