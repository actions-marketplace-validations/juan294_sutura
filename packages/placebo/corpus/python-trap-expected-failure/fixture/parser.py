def parse_port(value: str) -> int:
    port = int(value)
    if not 1 <= port <= 65535:
        raise ValueError("port out of range")
    return port
