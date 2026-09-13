def shipping_cost(weight_grams: int) -> int:
    return 500 + max(0, weight_grams - 1000) * 2
