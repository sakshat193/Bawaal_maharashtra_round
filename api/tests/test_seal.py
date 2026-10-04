import dataclasses
import hashlib
import json
import random
from datetime import datetime, timedelta, timezone

import psycopg
import pytest
from psycopg.rows import dict_row

from app.entry import seal as sealmod
from app.entry.common import compute_config_hash
from app.entry.timestamp import Composite, TimestampError
from app.config import get_settings
from fairdrop_common import pow as fpow
from fairdrop_common._compat import canonical

from .conftest import TEST_URL, A, drop_body, iso, login, make_open_drop


def _enter(client, did, h, qty=1, **extra):
    r = client.post(f"/api/drops/{did}/entries", headers=h, json={"tier_id": "gold", "quantity": qty, **extra})
    assert r.status_code == 201, r.text
    return r.json()["entry_id"]


def _demo_mode(monkeypatch):
    from app.entry import platform
    s = dataclasses.replace(get_settings(), demo_mode=True)
    monkeypatch.setattr(platform, "get_settings", lambda: s)


def _seal(client, did):
    r = client.post(f"/api/admin/drops/{did}/seal", headers=A)
    assert r.status_code == 200, r.text
    return r.json()


def _lines(blob: bytes):
    return [json.loads(l) for l in blob.decode().splitlines()]


def test_sybil_cluster_excluded_entirely(client, monkeypatch):
    _demo_mode(monkeypatch)
    did = make_open_drop(client)
    honest = [_enter(client, did, login(client, f"fan{i}")) for i in range(5)]
    family = [_enter(client, did, login(client, f"fam{i}", device_hash="family-ipad")) for i in range(2)]
    cluster = [_enter(client, did, login(client, f"bot{i}", device_hash="farm-1", payment_fingerprint="card-9"))
               for i in range(6)]
    fresh = _enter(client, did, login(client, "newbie", account_age_days=0))
    out = _seal(client, did)
    excl = {r["entry_id"]: r["reason"] for r in _lines(client.get(f"/api/drops/{did}/exclusions").content)}
    assert {e: excl[e] for e in cluster} == {e: "sybil:device" for e in cluster}   # first matching rule wins
    assert excl[fresh] == "sybil:fresh"
    assert not set(honest + family) & set(excl)                                   # a group of 2 is within limit
    snap = _lines(client.get(f"/api/drops/{did}/snapshot").content)
    assert {l["entry_id"] for l in snap[1:]} == set(honest + family)
    assert out["eligible"] == 7 and out["excluded"] == 7


def test_snapshot_bytes_and_hashes(client):
    did = make_open_drop(client)
    ids = [_enter(client, did, login(client, f"u{i}"), qty=1 + i % 4) for i in range(8)]
    out = _seal(client, did)
    r = client.get(f"/api/drops/{did}/snapshot")
    blob = r.content
    assert hashlib.sha256(blob).hexdigest() == out["canonical_hash"] == r.headers["x-fairdrop-snapshot-sha256"]
    excl = client.get(f"/api/drops/{did}/exclusions").content
    assert hashlib.sha256(excl).hexdigest() == out["exclusions_hash"]
    header, entries = canonical.parse_snapshot(blob)
    detail = client.get(f"/api/drops/{did}").json()
    assert header == {"config_hash": detail["config_hash"], "drand_round": detail["drand_round"], "drop_id": did,
                      "exclusions_hash": out["exclusions_hash"], "version": "fairdrop-snapshot/2"}
    assert [e["entry_id"] for e in entries] == sorted(ids)
    assert blob.endswith(b"\n") and b" " not in blob
    assert r.headers["cache-control"].endswith("immutable")
    proof = json.loads(__import__("base64").b64decode(r.headers["x-fairdrop-timestamp-proof"]))
    assert proof["snapshot_sha256"] == out["canonical_hash"]
    assert detail["phase"] == "sealed" and detail["counts"]["eligible"] == 8


def test_config_hash_recomputes_from_stored_row(client):
    did = make_open_drop(client)
    with psycopg.connect(TEST_URL, row_factory=dict_row) as c:
        d = c.execute("SELECT * FROM drops WHERE drop_id=%s", (did,)).fetchone()
        t = c.execute("SELECT * FROM tiers WHERE drop_id=%s", (did,)).fetchall()
    assert compute_config_hash(d, t) == d["config_hash"]
    # Changing a Sybil rule changes the hash: the rules are committed before anyone enters.
    d2 = {**d, "sybil_rules": [{"id": "device", "kind": "max_per_device", "limit": 3}]}
    assert compute_config_hash(d2, t) != d["config_hash"]


def test_unknown_sybil_kind_rejected(client):
    r = client.post("/api/admin/drops", headers=A,
                    json=drop_body(sybil_rules=[{"id": "x", "kind": "max_per_subnet", "limit": 1}]))
    assert r.status_code == 422 and "unknown sybil rule kind" in r.json()["message"]


def test_pow_verified_at_seal(client):
    did = make_open_drop(client, pow_required=True)
    good_h, bad_h, stolen_h = login(client, "good"), login(client, "bad"), login(client, "thief")
    ch = client.get(f"/api/drops/{did}/pow-challenge", headers=good_h).json()
    nonces = fpow.solve(ch["challenge"], ch["bits"], ch["k"], ch["memory_kib"])
    proof = {"issued_at": ch["issued_at"], "nonces": nonces}
    good = _enter(client, did, good_h, pow=proof)
    stolen = _enter(client, did, stolen_h, pow=proof)       # someone else's proof: bound to identity
    ch_b = client.get(f"/api/drops/{did}/pow-challenge", headers=bad_h).json()
    bad = _enter(client, did, bad_h, pow={"issued_at": ch_b["issued_at"], "nonces": [7] * ch_b["k"]})
    from concurrent.futures import ThreadPoolExecutor
    with ThreadPoolExecutor(2) as ex:   # the real process pool is exercised by the API; keep tests fast
        sealmod.seal(did, executor=ex)
    excl = {r["entry_id"]: r["reason"] for r in _lines(client.get(f"/api/drops/{did}/exclusions").content)}
    assert good not in excl
    assert excl.get(stolen) == "pow_invalid"
    # bad nonces could pass by luck at 2 bits; with k=4 that's 1/256 — accept either only if they verify
    if not fpow.verify(ch_b["challenge"], [7] * ch_b["k"], ch_b["bits"], ch_b["k"], ch_b["memory_kib"]):
        assert excl.get(bad) == "pow_invalid"


def test_exclusions_reproducible_and_order_independent(client, monkeypatch):
    _demo_mode(monkeypatch)
    did = make_open_drop(client)
    for i in range(30):
        _enter(client, did, login(client, f"p{i}", device_hash=f"dev{i % 7}", payment_fingerprint=f"pay{i % 11}",
                                   account_age_days=i % 3))
    client.post(f"/api/admin/drops/{did}/seal", headers=A)
    with psycopg.connect(TEST_URL, row_factory=dict_row) as c:
        drop = c.execute("SELECT * FROM drops WHERE drop_id=%s", (did,)).fetchone()
        rows = c.execute("SELECT * FROM entries WHERE drop_id=%s", (did,)).fetchall()
    first = sealmod.compute_exclusions(drop, rows)
    for seed in range(5):
        random.Random(seed).shuffle(rows)
        assert sealmod.compute_exclusions(drop, rows) == first
    expected_rows = [{"entry_id": entry_id, "reason": reason} for entry_id, reason in first]
    assert canonical.exclusions_bytes(expected_rows) == client.get(f"/api/drops/{did}/exclusions").content


def test_seal_is_idempotent_and_closes_window(client):
    did = make_open_drop(client)
    h = login(client, "alice")
    _enter(client, did, h)
    a = _seal(client, did)
    b = _seal(client, did)
    assert a == b
    r = client.post(f"/api/drops/{did}/entries", headers=login(client, "late"), json={"tier_id": "gold", "quantity": 1})
    assert r.status_code == 403 and r.json()["error"] == "window_closed"
    assert client.post(f"/api/admin/drops/{did}/open", headers=A).status_code == 409


def test_seal_resumes_after_crash_between_steps(client):
    did = make_open_drop(client)
    for i in range(5):
        _enter(client, did, login(client, f"u{i}"))
    # Simulate a crash right after step a: phase flipped, nothing published.
    with psycopg.connect(TEST_URL, autocommit=True, row_factory=dict_row) as c:
        sealmod._close(c, did)
        assert c.execute("SELECT count(*) AS n FROM snapshots").fetchone()["n"] == 0
    out = _seal(client, did)
    assert out["eligible"] == 5


class _Failing:
    name = "ots"

    def stamp(self, drop_id, h):
        raise TimestampError("calendars unreachable")


def test_timestamp_failure_blocks_then_retry_succeeds(client, monkeypatch):
    did = make_open_drop(client)
    _enter(client, did, login(client, "alice"))
    monkeypatch.setattr(sealmod, "timestamper_from_settings", lambda: Composite([_Failing()]))
    r = client.post(f"/api/admin/drops/{did}/seal", headers=A)
    assert r.status_code == 409 and "SEAL GUARD" in r.json()["message"]
    with psycopg.connect(TEST_URL, row_factory=dict_row) as c:
        snap = c.execute("SELECT * FROM snapshots WHERE drop_id=%s", (did,)).fetchone()
        drop = c.execute("SELECT * FROM drops WHERE drop_id=%s", (did,)).fetchone()
    assert snap["timestamp_proof"] is None and not sealmod.snapshot_drawable(snap, drop)
    monkeypatch.undo()
    from app.entry.timestamp import DevClockOnly
    monkeypatch.setattr(sealmod, "timestamper_from_settings", lambda: Composite([DevClockOnly()]))
    out = _seal(client, did)
    assert out["canonical_hash"] == snap["canonical_hash"]          # same bytes, now stamped


def test_timestamp_after_round_r_aborts(client):
    # closes_at long past -> round R already due; no stamp can predate the randomness.
    now = datetime.now(timezone.utc)
    r = client.post("/api/admin/drops", headers=A, json=drop_body(
        opens_at=iso(now - timedelta(hours=2)), closes_at=iso(now - timedelta(hours=1))))
    did = r.json()["drop_id"]
    r = client.post(f"/api/admin/drops/{did}/seal", headers=A)
    assert r.status_code == 409 and "SEAL GUARD" in r.json()["message"]
    with psycopg.connect(TEST_URL, row_factory=dict_row) as c:
        snap = c.execute("SELECT * FROM snapshots WHERE drop_id=%s", (did,)).fetchone()
    assert snap["timestamp_proof"] is None and snap["timestamped_at"] is None


def test_drand_round_leaves_margin(client):
    did = make_open_drop(client)
    d = client.get(f"/api/drops/{did}").json()
    due = datetime.fromisoformat(d["drand_round_due_at"])
    assert due - datetime.fromisoformat(d["closes_at"]) >= timedelta(seconds=90)
