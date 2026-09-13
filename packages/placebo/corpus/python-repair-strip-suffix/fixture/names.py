def without_suffix(name: str, suffix: str) -> str:
    return name[: -len(suffix)] if suffix and name.endswith(suffix) else name
