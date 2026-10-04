import dataclasses
from datetime import datetime, timedelta, timezone

import jwt
import psycopg

from app.config import get_settings
from app.entry import entries as entries_mod
from app.entry import platform as platform_mod
from app.entry import ratelimit as ratelimit_mod
from fairdrop_common import crypto
from fairdrop_common import pow as fpow

from .conftest import TEST_URL, A, drop_body, iso, login, make_open_drop


def _enter(client, did, h, tier="gold", qty=1, **extra):
    return client.post(f"/api/drops/{did}/entries", headers=h, json={"tier_id": tier, "quantity": qty, **extra})


def _row(entry_id):
    with psycopg.connect(TEST_URL) as c:
        return c.execute("SELECT * FROM entries WHERE entry_id=%s", (entry_id,)).fetchone()


def test_dedup_retry_and_different_terms(client):
    did = make_open_drop(client)
    h = login(client, "alice")
    r1 = _enter(client, did, h, qty=2)
    assert r1.status_code == 201
    r2 = _enter(client, did, login(client, "alice"), qty=2)      # fresh token, same identity
    assert r2.status_code == 200 and r2.json() == r1.json()
    r3 = _enter(client, did, h, qty=3)
    assert r3.status_code == 409 and r3.json()["error"] == "entry_exists_different_terms"
    r4 = _enter(client, did, h, tier="silver", qty=2)
    assert r4.status_code == 409
    with psycopg.connect(TEST_URL) as c:
        assert c.execute("SELECT count(*) FROM entries WHERE drop_id=%s", (did,)).fetchone()[0] == 1


def test_receipt_verifies_against_keys(client):
    did = make_open_drop(client)
    r = _enter(client, did, login(client, "alice"), qty=2).json()
    pub = client.get("/api/keys").json()["receipt"]["public_key"]
    assert crypto.verify_receipt(pub, r["receipt"], r["receipt_sig"])
    rc = r["receipt"]
    assert rc["entry_id"] == r["entry_id"] and len(r["entry_id"]) == 32
    assert rc["config_hash"] == client.get(f"/api/drops/{did}").json()["config_hash"]
    assert rc["accepted_at"].endswith("Z") and len(rc["accepted_at"].split(".")[1]) == 7  # 6 digits + Z
    tampered = {**rc, "quantity": 4}
    assert not crypto.verify_receipt(pub, tampered, r["receipt_sig"])


def test_validation_errors(client):
    did = make_open_drop(client, max_quantity=2)
    h = login(client, "alice")
    assert _enter(client, did, h, tier="platinum").json()["error"] == "unknown_tier"
    r = _enter(client, did, h, qty=3)
    assert r.status_code == 400 and r.json()["error"] == "quantity_exceeds_max"
    assert _enter(client, did, h, qty=0).status_code == 422


def test_window_closed_before_open_and_after_close(client):
    r = client.post("/api/admin/drops", headers=A, json=drop_body(
        opens_at=iso(datetime.now(timezone.utc) + timedelta(hours=1)),
        closes_at=iso(datetime.now(timezone.utc) + timedelta(hours=2))))
    did = r.json()["drop_id"]
    r = _enter(client, did, login(client, "alice"))
    assert r.status_code == 403 and r.json()["error"] == "window_closed"
    # Phase is checked before the proof shape, even on a PoW drop with no proof.
    r = client.post("/api/admin/drops", headers=A, json=drop_body(
        pow_required=True, opens_at=iso(datetime.now(timezone.utc) + timedelta(hours=1)),
        closes_at=iso(datetime.now(timezone.utc) + timedelta(hours=2))))
    r = _enter(client, r.json()["drop_id"], login(client, "alice"))
    assert r.status_code == 403 and r.json()["error"] == "window_closed"


def test_risk_facts_come_from_token_not_body(client):
    did = make_open_drop(client)
    h = login(client, "alice", device_hash="evil", payment_fingerprint="evil", account_age_days=0)
    claims = jwt.decode(h["Authorization"][7:], options={"verify_signature": False})
    assert claims["device_hash"] != "evil" and claims["payment_fingerprint"] != "evil"   # DEMO_MODE off
    r = _enter(client, did, h, device_hash="body", payment_fingerprint="body").json()
    row = _row(r["entry_id"])
    assert row[6] == claims["device_hash"] and row[7] == claims["payment_fingerprint"]


def test_demo_mode_knobs(client, monkeypatch):
    s = dataclasses.replace(get_settings(), demo_mode=True)
    monkeypatch.setattr(platform_mod, "get_settings", lambda: s)
    h = login(client, "bot1", device_hash="farm", payment_fingerprint="card", account_age_days=0)
    claims = jwt.decode(h["Authorization"][7:], options={"verify_signature": False})
    assert claims["device_hash"] == "farm" and claims["payment_fingerprint"] == "card"


def test_turnstile_failure(client, monkeypatch):
    did = make_open_drop(client, turnstile_required=True)
    monkeypatch.setattr(entries_mod.turnstile, "verify", lambda token, ip=None: False)
    r = _enter(client, did, login(client, "alice"), turnstile_token="bad")
    assert r.status_code == 400 and r.json()["error"] == "turnstile_failed"
    monkeypatch.setattr(entries_mod.turnstile, "verify", lambda token, ip=None: True)
    assert _enter(client, did, login(client, "alice"), turnstile_token="ok").status_code == 201


def test_pow_shape_checked_not_hashed(client):
    did = make_open_drop(client, pow_required=True)
    h = login(client, "alice")
    ch = client.get(f"/api/drops/{did}/pow-challenge", headers=h).json()
    assert _enter(client, did, h).status_code == 422                                     # missing
    bad = {"issued_at": ch["issued_at"], "nonces": [1, 2, 3]}
    assert _enter(client, did, h, pow=bad).status_code == 422                            # wrong count
    garbage = {"issued_at": ch["issued_at"], "nonces": [0] * ch["k"]}
    assert _enter(client, did, h, pow=garbage).status_code == 201                        # judged at the seal
    other = login(client, "bob")
    nonces = fpow.solve(ch["challenge"], ch["bits"], ch["k"], ch["memory_kib"])
    assert _enter(client, did, other, pow={"issued_at": ch["issued_at"], "nonces": nonces}).status_code == 201


def test_public_endpoints(client):
    did = make_open_drop(client)
    lst = client.get("/api/drops")
    assert lst.status_code == 200 and lst.headers["cache-control"] == "public, max-age=5, s-maxage=5"
    assert [d["drop_id"] for d in lst.json()["drops"]] == [did]
    d = client.get(f"/api/drops/{did}").json()
    assert d["phase"] == "open" and d["counts"] == {"entries": 0, "eligible": None, "excluded": None}
    assert d["drand_round_due_at"] > d["closes_at"] and d["server_time"].endswith("Z")
    assert client.get("/api/drops/00000000-0000-0000-0000-000000000000").status_code == 404
    assert client.get(f"/api/drops/{did}/snapshot").json()["error"] == "not_found"


def test_admin_requires_key(client):
    assert client.post("/api/admin/drops", json=drop_body()).status_code == 401
    assert client.post("/api/admin/drops", headers={"X-Admin-Key": "wrong"}, json=drop_body()).status_code == 401
    assert client.post("/api/admin/reset", json={}).status_code == 401


def test_traffic_view_groups_by_subnet_and_stays_out_of_snapshot(client, monkeypatch):
    s = dataclasses.replace(get_settings(), trusted_proxies=["testclient"])
    monkeypatch.setattr(ratelimit_mod, "get_settings", lambda: s)
    demo = dataclasses.replace(get_settings(), demo_mode=True)   # device_hash knob needs demo mode
    monkeypatch.setattr(platform_mod, "get_settings", lambda: demo)
    did = make_open_drop(client)
    for name, ip in (("a", "203.0.113.7"), ("b", "203.0.113.200"), ("c", "198.51.100.1")):
        h = {**login(client, name, device_hash="shared" if ip.startswith("203") else f"d-{name}"),
             "X-Forwarded-For": ip}
        assert _enter(client, did, h).status_code == 201
    assert client.get(f"/api/admin/drops/{did}/traffic").status_code == 401
    assert client.get("/api/admin/drops/00000000-0000-0000-0000-000000000000/traffic", headers=A).status_code == 404
    r = client.get(f"/api/admin/drops/{did}/traffic", headers=A)
    assert r.headers["cache-control"] == "private, no-store"
    top = r.json()["subnets"][0]
    assert (top["subnet"], top["entries"], top["devices"]) == ("203.0.113.0/24", 2, 1)
    assert r.json()["total"] == 3 and not r.json()["sealed"]
    assert client.post(f"/api/admin/drops/{did}/seal", headers=A).status_code == 200
    for path in ("snapshot", "exclusions"):
        body = client.get(f"/api/drops/{did}/{path}").content
        assert b"203.0.113" not in body and b"client_subnet" not in body


def test_admin_catalog_is_idempotent(client):
    assert client.post("/api/admin/catalog").status_code == 401
    first = client.post("/api/admin/catalog", headers=A).json()
    assert first == {"created": 60, "skipped": 0, "opened": 40}
    assert client.post("/api/admin/catalog", headers=A).json() == {"created": 0, "skipped": 60, "opened": 0}


def test_admin_draw_far_future_round_answers_409_not_hang(client):
    did = make_open_drop(client)                     # closes in 30 min, so its drand round is far off
    r = client.post(f"/api/admin/drops/{did}/draw", headers=A)
    assert r.status_code == 409 and r.json()["error"] == "draw_not_due" and "due_at" in r.json()
    assert client.post("/api/admin/drops/00000000-0000-0000-0000-000000000000/draw", headers=A).status_code == 404
