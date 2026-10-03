"""Exact integer ranking for the sealed Fair Drop allocation."""

from __future__ import annotations

import hashlib
import re
from uuid import UUID

from .canonical import parse_ts


_HEX_32 = re.compile(r"^[0-9a-fA-F]{64}$")
_HEX_16 = re.compile(r"^[0-9a-fA-F]{32}$")


def digest(drop_id: str | UUID, randomness: str, entry_id: str) -> int:
    """Return U from the rank/v1 digest, replacing zero with one."""
    try:
        drop = drop_id if isinstance(drop_id, UUID) else UUID(str(drop_id))
    except (ValueError, TypeError, AttributeError) as exc:
        raise ValueError("drop_id must be a UUID") from exc
    if not isinstance(randomness, str) or not _HEX_32.fullmatch(randomness):
        raise ValueError("randomness must be 32 bytes of hexadecimal")
    if not isinstance(entry_id, str) or not _HEX_16.fullmatch(entry_id):
        raise ValueError("entry_id must be 16 bytes of hexadecimal")
    message = (
        b"fairdrop/rank/v1\x00"
        + drop.bytes
        + bytes.fromhex(randomness)
        + bytes.fromhex(entry_id)
    )
    return int.from_bytes(hashlib.sha256(message).digest(), "big") or 1


def _quantity(entry: dict) -> int:
    quantity = entry["quantity"]
    if isinstance(quantity, bool) or not isinstance(quantity, int) or not 1 <= quantity <= 4:
        raise ValueError("entry quantity must be an integer from 1 to 4")
    return quantity


def lottery_order(entries: list[dict], drop_id: str | UUID, randomness: str) -> list[dict]:
    """Order entries by the WIL integer key, descending, then entry_id."""
    def key(entry):
        quantity = _quantity(entry)
        value = digest(drop_id, randomness, entry["entry_id"])
        return (-(value**quantity << (256 * (4 - quantity))), entry["entry_id"])

    return sorted(entries, key=key)


def fcfs_order(entries: list[dict]) -> list[dict]:
    """Order by accepted_at ascending, then entry_id."""
    return sorted(
        entries,
        key=lambda entry: (parse_ts(entry["accepted_at"]), entry["entry_id"]),
    )

