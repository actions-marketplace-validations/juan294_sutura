def top_scores(records: list[dict]) -> list[str]:
    return [record["name"] for record in sorted(records, key=lambda item: -item["score"])]
