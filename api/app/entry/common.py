"""Helpers shared by the entry module: config dict, lock keys, drop loading."""
import hashlib
import uuid

from fairdrop_common._compat import canonical, drand

from ..errors import ApiError
from ..timefmt import iso_s

CONFIG_FIELDS = (
    "drop_id", "name", "venue", "starts_at", "opens_at", "closes_at", "allocation_mode",
    "pow_required", "turnstile_required", "pow_bits", "pow_k", "pow_memory_kib", "max_quantity",
    "offer_ttl_s", "pay_deadline_s", "max_promotion_rounds", "sybil_rules", "drand_chain", "drand_round",
)
TIME_FIELDS = ("starts_at", "opens_at", "closes_at")


def config_dict(drop: dict) -> dict:
    """Every drop field except phase and config_hash, JSON-ready (UUID str, whole-second Z times)."""
    out = {}
    for k in CONFIG_FIELDS:
        v = drop[k]
        if k in TIME_FIELDS:
            v = iso_s(v)
        elif k == "drop_id":
            v = str(v)
        out[k] = v
    return out


def tier_dicts(tiers: list[dict]) -> list[dict]:
    return [{"tier_id": t["tier_id"], "name": t["name"], "price_paise": t["price_paise"],
             "capacity": t["capacity"]} for t in tiers]


def compute_config_hash(drop: dict, tiers: list[dict]) -> str:
    return hashlib.sha256(canonical.config_bytes(config_dict(drop), tier_dicts(tiers))).hexdigest()


def _lock_key(label: bytes, drop_id) -> int:
    d = drop_id if isinstance(drop_id, uuid.UUID) else uuid.UUID(str(drop_id))
    return int.from_bytes(hashlib.sha256(label + d.bytes).digest()[:8], "big", signed=True)


def fence_key(drop_id) -> int:
    """Advisory lock: entries take it shared, the seal's close step takes it exclusive."""
    return _lock_key(b"fairdrop/fence/", drop_id)


def seal_key(drop_id) -> int:
    """Session advisory lock so only one seal pipeline runs per drop."""
    return _lock_key(b"fairdrop/seal/", drop_id)


def round_due_unix(drop: dict) -> int:
    return drand.time_of(drop["drand_round"])


def load_drop(conn, drop_id, *, for_update: bool = False) -> dict:
    row = conn.execute(
        "SELECT * FROM drops WHERE drop_id = %s" + (" FOR UPDATE" if for_update else ""), (drop_id,)
    ).fetchone()
    if row is None:
        raise ApiError(404, "not_found", "no such drop")
    return row


def load_tiers(conn, drop_id) -> list[dict]:
    return conn.execute("SELECT * FROM tiers WHERE drop_id = %s ORDER BY tier_id", (drop_id,)).fetchall()
