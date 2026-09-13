from typing import List


class Queue:
    def __init__(self) -> None:
        self._items: List[str] = []

    def add(self, item: str) -> None:
        self._items.append(item)

    def items(self) -> List[str]:
        return list(self._items)
