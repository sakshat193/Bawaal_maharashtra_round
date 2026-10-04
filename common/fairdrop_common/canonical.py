"""Canonical Fair Drop encodings. These bytes are part of the public contract."""

from __future__ import annotations

import json
import re
from datetime import datetime, timezone
from uuid import UUID


SNAPSHOT_VERSION = "fairdrop-snapshot/2"
_HEADER_FIELDS = ("config_hash", "drand_round", "drop_id", "exclusions_hash")
_ENTRY_FIELDS = ("accepted_at", "entry_id", "quantity", "tier_id")
_EXCLUSION_FIELDS = ("entry_id", "reason")
_ENTRY_ID = re.compile(r"^[0-9a-f]{32}$")
_HASH = re.compile(r"^[0-9a-f]{64}$")


def parse_ts(value: str | datetime) -> datetime:
    """Parse an offset-aware ISO-8601 timestamp and return UTC."""
    if isinstance(value, datetime):
        parsed = value
    elif isinstance(value, str):
        source = value.strip()
        if source.endswith("Z"):
            source = source[:-1] + "+00:00"
        try:
            parsed = datetime.fromisoformat(source)
        except ValueError as exc:
            raise ValueError(f"invalid ISO-8601 timestamp: {value!r}") from exc
    else:
        raise TypeError("timestamp must be a string or datetime")
    if parsed.tzinfo is None or parsed.utcoffset() is None:
        raise ValueError("timestamp must include a UTC offset")
    return parsed.astimezone(timezone.utc)


def fmt_ts(value: str | datetime, timespec: str = "seconds") -> str:
    """Format a timestamp in UTC, ending in Z; accepted_at uses microseconds."""
    if timespec not in {"seconds", "milliseconds", "microseconds"}:
        raise ValueError("timespec must be seconds, milliseconds, or microseconds")
    return parse_ts(value).isoformat(timespec=timespec).replace("+00:00", "Z")


def _json_value(value, path="$"):
    if value is None or isinstance(value, (str, bool, int)):
        return value
    if isinstance(value, float):
        raise TypeError(f"floating-point values are not canonical ({path})")
    if isinstance(value, UUID):
        return str(value)
    if isinstance(value, datetime):
        return fmt_ts(value)
    if isinstance(value, (list, tuple)):
        return [_json_value(item, f"{path}[{index}]") for index, item in enumerate(value)]
    if isinstance(value, dict):
        result = {}
        for key, item in value.items():
            if not isinstance(key, str):
                raise TypeError(f"JSON object keys must be strings ({path})")
            result[key] = _json_value(item, f"{path}.{key}")
        return result
    raise TypeError(f"unsupported canonical value {type(value).__name__} ({path})")


def _json_bytes(value) -> bytes:
    normalized = _json_value(value)
    return json.dumps(
        normalized,
        sort_keys=True,
        separators=(",", ":"),
        ensure_ascii=True,
        allow_nan=False,
    ).encode("utf-8")


def config_bytes(drop: dict, tiers: list[dict]) -> bytes:
    """Encode the immutable drop config, omitting phase and runtime tier counts."""
    config = dict(drop)
    config.pop("phase", None)
    config.pop("config_hash", None)
    config.pop("tiers", None)
    for field in ("starts_at", "opens_at", "closes_at"):
        if field in config and config[field] is not None:
            config[field] = fmt_ts(config[field])

    stable_tiers = []
    for tier in tiers:
        item = dict(tier)
        item.pop("held", None)
        item.pop("general_sale_units", None)
        stable_tiers.append(item)
    stable_tiers.sort(key=lambda item: item["tier_id"])
    tier_ids = [item["tier_id"] for item in stable_tiers]
    if len(tier_ids) != len(set(tier_ids)):
        raise ValueError("tier_id values must be unique")
    config["tiers"] = stable_tiers
    return _json_bytes(config)


def exclusions_bytes(rows: list[dict]) -> bytes:
    """Encode one exclusion per line in entry_id order, with a final newline."""
    normalized = [
        {"entry_id": row["entry_id"], "reason": row["reason"]}
        for row in rows
    ]
    for row in normalized:
        if not isinstance(row["entry_id"], str) or not _ENTRY_ID.fullmatch(row["entry_id"]):
            raise ValueError("entry_id must be 32 lowercase hexadecimal characters")
        if not isinstance(row["reason"], str) or not row["reason"]:
            raise ValueError("exclusion reason must be a non-empty string")
    if len({row["entry_id"] for row in normalized}) != len(normalized):
        raise ValueError("an entry can have only one exclusion row")
    normalized.sort(key=lambda row: row["entry_id"])
    return b"".join(_json_bytes(row) + b"\n" for row in normalized)


def snapshot_bytes(header: dict, entries: list[dict]) -> bytes:
    """Encode the fixed snapshot header followed by eligible entries by entry_id."""
    first = {key: header[key] for key in _HEADER_FIELDS}
    if not isinstance(first["drop_id"], str):
        raise ValueError("drop_id must be a UUID string")
    try:
        UUID(first["drop_id"])
    except ValueError as exc:
        raise ValueError("drop_id must be a UUID string") from exc
    if isinstance(first["drand_round"], bool) or not isinstance(first["drand_round"], int) or first["drand_round"] < 1:
        raise ValueError("drand_round must be a positive integer")
    for field in ("config_hash", "exclusions_hash"):
        if not isinstance(first[field], str) or not _HASH.fullmatch(first[field]):
            raise ValueError(f"{field} must be 64 lowercase hexadecimal characters")
    first["version"] = SNAPSHOT_VERSION
    ordered = []
    for entry in entries:
        item = {key: entry[key] for key in _ENTRY_FIELDS}
        if not isinstance(item["entry_id"], str) or not _ENTRY_ID.fullmatch(item["entry_id"]):
            raise ValueError("entry_id must be 32 lowercase hexadecimal characters")
        if isinstance(item["quantity"], bool) or not isinstance(item["quantity"], int) or not 1 <= item["quantity"] <= 4:
            raise ValueError("quantity must be an integer from 1 to 4")
        if not isinstance(item["tier_id"], str) or not item["tier_id"]:
            raise ValueError("tier_id must be a non-empty string")
        item["accepted_at"] = fmt_ts(item["accepted_at"], "microseconds")
        ordered.append(item)
    if len({row["entry_id"] for row in ordered}) != len(ordered):
        raise ValueError("snapshot entry_id values must be unique")
    ordered.sort(key=lambda row: row["entry_id"])
    return _json_bytes(first) + b"\n" + b"".join(
        _json_bytes(row) + b"\n" for row in ordered
    )


def parse_snapshot(blob: bytes | str) -> tuple[dict, list[dict]]:
    """Parse and canonicality-check a snapshot, returning (header, entries)."""
    raw = blob.encode("utf-8") if isinstance(blob, str) else bytes(blob)
    if not raw.endswith(b"\n"):
        raise ValueError("snapshot must end with a newline")
    lines = raw[:-1].split(b"\n")
    if not lines or any(not line for line in lines):
        raise ValueError("snapshot contains an empty line")
    try:
        values = [json.loads(line) for line in lines]
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise ValueError("snapshot contains invalid JSON") from exc
    header, entries = values[0], values[1:]
    if set(header) != {*_HEADER_FIELDS, "version"}:
        raise ValueError("snapshot header has the wrong fields")
    if header["version"] != SNAPSHOT_VERSION:
        raise ValueError(f"unsupported snapshot version: {header['version']!r}")
    if any(set(entry) != set(_ENTRY_FIELDS) for entry in entries):
        raise ValueError("snapshot entry has the wrong fields")
    if snapshot_bytes(header, entries) != raw:
        raise ValueError("snapshot is not in canonical form")
    return header, entries


def receipt_bytes(receipt: dict) -> bytes:
    """Encode the complete receipt object for Ed25519 signing/verification."""
    normalized = dict(receipt)
    if "accepted_at" in normalized:
        normalized["accepted_at"] = fmt_ts(
            normalized["accepted_at"], "microseconds"
        )
    return _json_bytes(normalized)

