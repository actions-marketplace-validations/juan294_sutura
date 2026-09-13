from typing import List, Optional


def add_item(item: str, basket: Optional[List[str]] = None) -> List[str]:
    if basket is None:
        basket = []
    basket.append(item)
    return basket
