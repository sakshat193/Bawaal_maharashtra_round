"""Canonical timestamp formats: ISO-8601 UTC ending in Z.

accepted_at keeps microseconds (always 6 digits); everything else is whole seconds.
"""
from datetime import datetime, timezone


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def iso_s(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def iso_us(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%fZ")


def parse_iso(s: str) -> datetime:
    dt = datetime.fromisoformat(s)
    if dt.tzinfo is None:
        raise ValueError("timestamp must include a timezone (use Z)")
    return dt.astimezone(timezone.utc)


def from_unix(ts: int | float) -> datetime:
    return datetime.fromtimestamp(ts, timezone.utc)
