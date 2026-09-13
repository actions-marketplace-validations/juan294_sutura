from datetime import datetime, timedelta, timezone


def expires_at(issued: datetime, hours: int) -> datetime:
    if issued.tzinfo is None:
        issued = issued.replace(tzinfo=timezone.utc)
    return issued + timedelta(hours=hours)


def is_expired(issued: datetime, hours: int, now: datetime) -> bool:
    if now.tzinfo is None:
        now = now.replace(tzinfo=timezone.utc)
    return now >= expires_at(issued, hours)
