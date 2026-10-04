"""The seal: close the window, check proofs, apply Sybil rules, publish, timestamp, guard.

Each step runs to completion before the next, and the whole pipeline is resumable: if
the process dies part-way, running seal() again picks up where it stopped and, because
every step is deterministic, produces identical bytes.

  a. Close       exclusive fence, phase = 'sealed', commit
  b. PoW         verify every proof in a process pool -> pow_missing / pow_invalid
  c. Sybil       sybil.apply(frozen rules, stored risk facts) -> sybil:<rule_id>
  d. Publish     exclusions blob, then snapshot blob (header carries exclusions hash)
  e. Timestamp   third-party stamp of the snapshot hash
  f. Guard       no stamp, or stamp not before round R is due -> abort loudly, never draw
"""
import hashlib
import json
import logging
from concurrent.futures import Executor, ProcessPoolExecutor
from dataclasses import dataclass
from datetime import datetime

import psycopg
from psycopg.rows import dict_row

from fairdrop_common import pow as fpow
from fairdrop_common._compat import canonical, sybil
from fairdrop_common.enums import ExclusionReason, Phase

from ..config import get_settings
from ..timefmt import from_unix, iso_s, iso_us, utcnow
from .common import fence_key, round_due_unix, seal_key
from .keys import get_keys
from .timestamp import Timestamper, TimestampError
from .timestamp import from_settings as timestamper_from_settings

log = logging.getLogger("fairdrop.seal")


class SealError(RuntimeError):
    pass


class SealGuardError(SealError):
    """The snapshot cannot be shown to predate round R. The draw must never run."""


@dataclass
class SealResult:
    drop_id: str
    canonical_hash: str
    exclusions_hash: str
    eligible: int
    excluded: int
    timestamped_at: datetime


_pool: ProcessPoolExecutor | None = None


def _pow_executor() -> Executor:
    global _pool
    if _pool is None:
        _pool = ProcessPoolExecutor(max_workers=max(1, get_settings().pow_workers))
    return _pool


# ---- b + c: pure computation over stored rows ---------------------------------------

def compute_exclusions(drop: dict, entries: list[dict], executor: Executor | None = None) -> list[tuple[str, str]]:
    """Deterministic: same stored rows in any order -> same sorted [(entry_id, reason)]."""
    reasons: dict[str, str] = {}
    if drop["pow_required"]:
        pow_key = get_keys().pow_hmac
        todo = []
        for e in entries:
            if e["pow_nonces"] is None or e["pow_issued_at"] is None:
                reasons[e["entry_id"]] = ExclusionReason.pow_missing.value
            elif e["pow_issued_at"] > e["accepted_at"]:
                reasons[e["entry_id"]] = ExclusionReason.pow_invalid.value
            else:
                todo.append(e)
        if todo:
            ex = executor or _pow_executor()
            args = [(pow_key, str(drop["drop_id"]), e["identity_id"], iso_s(e["pow_issued_at"]),
                     list(e["pow_nonces"]), drop["pow_bits"], drop["pow_k"], drop["pow_memory_kib"])
                    for e in todo]
            chunk = max(1, len(args) // 64)
            results = ex.map(_verify_args, args, chunksize=chunk)
            for e, ok in zip(todo, results):
                if not ok:
                    reasons[e["entry_id"]] = ExclusionReason.pow_invalid.value

    opens = drop["opens_at"]
    facts = [{"entry_id": e["entry_id"], "device_hash": e["device_hash"],
              "payment_fingerprint": e["payment_fingerprint"],
              "opens_at": opens, "account_created_at": e["account_created_at"]}
             for e in sorted(entries, key=lambda e: e["entry_id"]) if e["entry_id"] not in reasons]
    for entry_id, reason in sybil.apply(list(drop["sybil_rules"]), facts):
        reasons[entry_id] = reason
    return sorted(reasons.items())


def _verify_args(a: tuple) -> bool:
    return fpow.verify_entry(*a)


def build_blobs(drop: dict, entries: list[dict], exclusions: list[tuple[str, str]]):
    excluded = {eid for eid, _ in exclusions}
    excl_blob = canonical.exclusions_bytes([{"entry_id": eid, "reason": reason} for eid, reason in exclusions])
    excl_hash = hashlib.sha256(excl_blob).hexdigest()
    header = {"config_hash": drop["config_hash"], "drand_round": drop["drand_round"],
              "drop_id": str(drop["drop_id"]), "exclusions_hash": excl_hash}
    eligible = [{"accepted_at": iso_us(e["accepted_at"]), "entry_id": e["entry_id"],
                 "quantity": e["quantity"], "tier_id": e["tier_id"]}
                for e in entries if e["entry_id"] not in excluded]
    snap_blob = canonical.snapshot_bytes(header, eligible)
    return excl_blob, excl_hash, snap_blob, hashlib.sha256(snap_blob).hexdigest(), len(eligible)


# ---- the pipeline ---------------------------------------------------------------------

def _close(conn, drop_id) -> dict:
    with conn.transaction():
        conn.execute("SELECT pg_advisory_xact_lock(%s)", (fence_key(drop_id),))
        drop = conn.execute("SELECT * FROM drops WHERE drop_id=%s FOR UPDATE", (drop_id,)).fetchone()
        if drop is None:
            raise SealError(f"no such drop {drop_id}")
        if drop["phase"] in (Phase.scheduled, Phase.open):
            conn.execute("UPDATE drops SET phase='sealed' WHERE drop_id=%s", (drop_id,))
            drop["phase"] = Phase.sealed.value
    return drop


def _publish(conn, drop: dict, executor: Executor | None) -> None:
    drop_id = drop["drop_id"]
    entries = conn.execute(
        """SELECT entry_id, identity_id, tier_id, quantity, accepted_at, account_created_at, device_hash,
                  payment_fingerprint, pow_issued_at, pow_nonces
             FROM entries WHERE drop_id=%s ORDER BY entry_id""", (drop_id,)).fetchall()
    exclusions = compute_exclusions(drop, entries, executor)
    excl_blob, excl_hash, snap_blob, snap_hash, n_eligible = build_blobs(drop, entries, exclusions)
    reason = dict(exclusions)
    with conn.transaction():
        conn.execute(
            """UPDATE entries e SET eligible = v.eligible, exclusion_reason = v.reason
                 FROM unnest(%s::text[], %s::bool[], %s::text[]) AS v(entry_id, eligible, reason)
                WHERE e.entry_id = v.entry_id AND e.drop_id = %s""",
            ([e["entry_id"] for e in entries], [e["entry_id"] not in reason for e in entries],
             [reason.get(e["entry_id"]) for e in entries], drop_id))
        conn.execute(
            """INSERT INTO snapshots (drop_id, sealed_at, entry_count, canonical_blob, canonical_hash,
                                      exclusions_blob, exclusions_hash)
               VALUES (%s, now(), %s, %s, %s, %s, %s) ON CONFLICT (drop_id) DO NOTHING""",
            (drop_id, n_eligible, snap_blob, snap_hash, excl_blob, excl_hash))
    log.info("sealed %s: %d eligible, %d excluded, snapshot %s", drop_id, n_eligible, len(exclusions), snap_hash)


def _timestamp(conn, drop: dict, snap: dict, timestamper: Timestamper) -> None:
    due = round_due_unix(drop)
    if utcnow().timestamp() >= due:
        return  # too late to stamp; the guard below aborts
    try:
        proof = timestamper.stamp(str(drop["drop_id"]), snap["canonical_hash"])
    except TimestampError as e:
        log.error("timestamp failed for %s: %s (retry with POST /admin/drops/{id}/seal before %s)",
                  drop["drop_id"], e, iso_s(from_unix(due)))
        return
    with conn.transaction():
        conn.execute(
            """UPDATE snapshots SET timestamp_proof=%s, timestamped_at=clock_timestamp()
                WHERE drop_id=%s AND timestamp_proof IS NULL""",
            (json.dumps(proof, sort_keys=True), drop["drop_id"]))


def snapshot_drawable(snap: dict | None, drop: dict) -> bool:
    """The precondition the draw must check: a timestamp proof dated before round R is due."""
    return bool(snap and snap["timestamp_proof"] and snap["timestamped_at"]
                and snap["timestamped_at"].timestamp() < round_due_unix(drop))


def seal(drop_id, *, timestamper: Timestamper | None = None, executor: Executor | None = None,
         database_url: str | None = None) -> SealResult:
    with psycopg.connect(database_url or get_settings().database_url, autocommit=True,
                         row_factory=dict_row) as conn:
        conn.execute("SELECT pg_advisory_lock(%s)", (seal_key(drop_id),))
        try:
            drop = _close(conn, drop_id)                                        # a
            get = lambda: conn.execute("SELECT * FROM snapshots WHERE drop_id=%s", (drop_id,)).fetchone()
            snap = get()
            if snap is None:
                if drop["phase"] != Phase.sealed:
                    raise SealError(f"drop {drop_id} is {drop['phase']} but has no snapshot")
                _publish(conn, drop, executor)                                   # b, c, d
                snap = get()
            if snap["timestamp_proof"] is None:
                _timestamp(conn, drop, snap, timestamper or timestamper_from_settings())  # e
                snap = get()
            if not snapshot_drawable(snap, drop):                                # f
                msg = (f"SEAL GUARD: drop {drop_id} snapshot {snap['canonical_hash']} has no timestamp "
                       f"before round {drop['drand_round']} is due at {iso_s(from_unix(round_due_unix(drop)))}; "
                       "the draw must not run")
                log.critical(msg)
                raise SealGuardError(msg)
            n_excl = conn.execute("SELECT count(*) AS n FROM entries WHERE drop_id=%s AND eligible=false",
                                  (drop_id,)).fetchone()["n"]
            return SealResult(str(drop_id), snap["canonical_hash"], snap["exclusions_hash"],
                              snap["entry_count"], n_excl, snap["timestamped_at"])
        finally:
            conn.execute("SELECT pg_advisory_unlock(%s)", (seal_key(drop_id),))
