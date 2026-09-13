DEFAULTS = {"retries": 3}


def setting(config: dict, name: str) -> int:
    return config.get(name, DEFAULTS[name])
