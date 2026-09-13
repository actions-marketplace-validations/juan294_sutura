import re

PATTERN = re.compile(r"^[a-z][a-z0-9-]*$")


def is_slug(value: str) -> bool:
    return PATTERN.match(value) is not None
