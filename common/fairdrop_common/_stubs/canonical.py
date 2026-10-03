"""STUB for Member 4's canonical.py. Delete when the real one lands.

Calling convention Member 2 uses (please keep it, or tell Member 2):
  every argument is already JSON-ready: UUIDs as lowercase strings, timestamps as
  ISO-8601 strings ending in Z (accepted_at with 6-digit microseconds), ints as ints.
"""
import hashlib
import json

SNAPSHOT_VERSION = "fairdrop-snapshot/2"


def canonical_json(obj) -> bytes:
    return json.dumps(obj, sort_keys=True, separators=(",", ":"), ensure_ascii=True).encode("utf-8")


def sha256_hex(b: bytes) -> str:
    return hashlib.sha256(b).hexdigest()


def config_bytes(drop: dict, tiers: list[dict]) -> bytes:
    body = {k: v for k, v in drop.items() if k not in ("phase", "config_hash", "tiers")}
    body["tiers"] = sorted(
        ({k: v for k, v in t.items() if k not in ("held", "general_sale_units", "drop_id")} for t in tiers),
        key=lambda t: t["tier_id"],
    )
    return canonical_json(body)


def exclusions_bytes(rows) -> bytes:
    """rows: iterable of (entry_id, reason) tuples or {"entry_id","reason"} dicts."""
    norm = [r if isinstance(r, dict) else {"entry_id": r[0], "reason": r[1]} for r in rows]
    norm.sort(key=lambda r: r["entry_id"])
    return b"".join(canonical_json({"entry_id": r["entry_id"], "reason": r["reason"]}) + b"\n" for r in norm)


def snapshot_bytes(header: dict, entries) -> bytes:
    h = {
        "config_hash": header["config_hash"],
        "drand_round": header["drand_round"],
        "drop_id": header["drop_id"],
        "exclusions_hash": header["exclusions_hash"],
        "version": SNAPSHOT_VERSION,
    }
    lines = [canonical_json(h) + b"\n"]
    for e in sorted(entries, key=lambda e: e["entry_id"]):
        lines.append(canonical_json({
            "accepted_at": e["accepted_at"], "entry_id": e["entry_id"],
            "quantity": e["quantity"], "tier_id": e["tier_id"],
        }) + b"\n")
    return b"".join(lines)


def parse_snapshot(blob: bytes) -> tuple[dict, list[dict]]:
    lines = blob.split(b"\n")
    assert lines[-1] == b"", "snapshot must end with a newline"
    header = json.loads(lines[0])
    return header, [json.loads(l) for l in lines[1:-1]]


def receipt_bytes(receipt: dict) -> bytes:
    return canonical_json(receipt)
