from pricing import line_total


def invoice_total(lines: list[dict[str, int]], discount: int) -> int:
    return sum(line_total(line["unit_price"], line["quantity"], discount) for line in lines)
