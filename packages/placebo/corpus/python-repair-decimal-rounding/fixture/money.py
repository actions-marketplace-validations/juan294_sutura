from decimal import Decimal


def total_cents(prices: list[str]) -> int:
    return int(sum(Decimal(price) for price in prices) * 100)
