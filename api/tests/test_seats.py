"""Seat selection after the lottery: rank-ordered waves, amber locks, red bookings.

Runs the real path: entries -> seal -> Member 3's draw (with a fixed randomness) -> seats.
"""
import asyncio
import threading
import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime

import httpx
import psycopg
import pytest
from psycopg.errors import CheckViolation, UniqueViolation

from app import alloc as alloc_module
from app.alloc import _Connection, _draw_drop, _sweep_once

from .conftest import TEST_URL, A, drop_body, login


def _drawn_drop(c, monkeypatch, *, users=5, capacity=6, seat_selection=True, wave_size=2, wave_s=30, qty=1):
    """Create, fill, seal and draw a drop. Returns (drop_id, [(username, headers, offer_id)] in rank order)."""
    r = c.post("/api/admin/drops", headers=A, json=drop_body(
        sybil_rules=[], seat_selection=seat_selection, seat_wave_size=wave_size, seat_wave_s=wave_s,
        offer_ttl_s=120, pay_deadline_s=60,
        tiers=[{"tier_id": "gold", "name": "Gold", "price_paise": 450000, "capacity": capacity}]))
    assert r.status_code == 201, r.text
    did = r.json()["drop_id"]
    assert c.post(f"/api/admin/drops/{did}/open", headers=A).status_code == 200
    heads = {}
    for i in range(users):
        u = f"seat-{uuid.uuid4().hex[:8]}-{i}"
        heads[u] = login(c, u)
        e = c.post(f"/api/drops/{did}/entries", headers=heads[u], json={"tier_id": "gold", "quantity": qty})
        assert e.status_code == 201, e.text
    assert c.post(f"/api/admin/drops/{did}/seal", headers=A).status_code == 200

    async def fake_fetch(_round):
        return {"signature": "ab", "randomness": "cd" * 32}
    monkeypatch.setattr(alloc_module, "fetch_drand", fake_fetch)
    with psycopg.connect(TEST_URL, autocommit=True) as conn:
        assert asyncio.run(_draw_drop(_Connection(conn), uuid.UUID(did)))
    ranked = []
    for u, h in heads.items():
        me = c.get(f"/api/drops/{did}/me", headers=h).json()
        if me["offer"]:
            ranked.append((me["entry"]["rank"], u, h, me["offer"]["offer_id"]))
    ranked.sort()
    return did, [(u, h, oid) for _, u, h, oid in ranked]


def _put(c, h, oid, seats):
    return c.put(f"/api/offers/{oid}/seats", headers=h, json={"seats": seats})


def _map(c, did):
    t = c.get(f"/api/drops/{did}/seats").json()["tiers"][0]
    return t["locked"], t["booked"]


def _parse(s):
    return datetime.fromisoformat(s)


def test_waves_open_in_rank_order(client, monkeypatch):
    did, offers = _drawn_drop(client, monkeypatch, users=5, capacity=6, wave_size=2, wave_s=30)
    views = [client.get(f"/api/offers/{oid}/seats", headers=h).json() for _, h, oid in offers]
    opens = [_parse(v["window_opens_at"]) for v in views]
    gaps = [round((o - opens[0]).total_seconds()) for o in opens]
    # ranks 1-2 open now, 3-4 after 30 s, 5 after 60 s (whole-second rounding)
    assert [g // 30 for g in gaps] == [0, 0, 1, 1, 2], gaps
    assert [v["window_open"] for v in views] == [True, True, False, False, False]
    # every winner still gets the full offer TTL after their window opens
    assert all(round((_parse(v["window_closes_at"]) - _parse(v["window_opens_at"])).total_seconds()) == 120
               for v in views)
    _, h3, oid3 = offers[2]
    r = _put(client, h3, oid3, [0])
    assert r.status_code == 409 and r.json()["error"] == "seat_window_not_open" and r.json()["opens_at"]


def test_amber_lock_is_exclusive_and_replaceable(client, monkeypatch):
    did, offers = _drawn_drop(client, monkeypatch, users=2, wave_size=10)
    (_, ha, a), (_, hb, b) = offers
    assert _put(client, ha, a, [3]).json()["seats"] == [3]
    assert _map(client, did) == ([3], [])
    r = _put(client, hb, b, [3])
    assert r.status_code == 409 and r.json()["error"] == "seat_taken" and r.json()["seats"] == [3]
    assert _put(client, hb, b, [4]).status_code == 200
    assert _put(client, ha, a, [5]).json()["seats"] == [5]          # A moves; seat 3 turns green again
    assert _map(client, did) == ([4, 5], [])
    assert _put(client, hb, b, [3]).status_code == 200            # now B can take 3
    assert _put(client, ha, a, []).json()["seats"] == []           # unselect everything
    assert _map(client, did) == ([3], [])


def test_buy_needs_exactly_quantity_seats_and_freezes_choice(client, monkeypatch):
    did, offers = _drawn_drop(client, monkeypatch, users=1, qty=2, wave_size=10)
    (_, h, oid), = offers
    redeem = lambda: client.post(f"/api/offers/{oid}/redeem", headers=h, json={"order_id": "o-" + oid})
    assert redeem().json()["error"] == "seats_not_selected"
    _put(client, h, oid, [1])
    assert redeem().json()["error"] == "seats_not_selected"
    _put(client, h, oid, [1, 2])
    assert redeem().status_code == 200
    r = _put(client, h, oid, [3, 4])
    assert r.status_code == 409 and r.json()["error"] == "not_offered"
    assert _map(client, did) == ([1, 2], [])                        # still amber while paying


def test_paid_seats_turn_red_and_failed_or_declined_seats_turn_green(client, monkeypatch):
    did, offers = _drawn_drop(client, monkeypatch, users=3, wave_size=10)
    (_, h1, o1), (_, h2, o2), (_, h3, o3) = offers
    for h, o, s in ((h1, o1, 0), (h2, o2, 1), (h3, o3, 2)):
        assert _put(client, h, o, [s]).status_code == 200
    for h, o in ((h1, o1), (h2, o2)):
        assert client.post(f"/api/offers/{o}/redeem", headers=h, json={"order_id": "o-" + o}).status_code == 200
    assert client.post(f"/api/offers/{o1}/pay", headers=h1, json={"order_id": "o-" + o1, "result": "success"}).json() == {"status": "confirmed"}
    assert client.post(f"/api/offers/{o2}/pay", headers=h2, json={"order_id": "o-" + o2, "result": "fail"}).json() == {"status": "payment_failed"}
    assert client.post(f"/api/offers/{o3}/decline", headers=h3).status_code == 200
    assert _map(client, did) == ([], [0])                          # 0 red; 1 and 2 green again
    assert client.get(f"/api/offers/{o1}/seats", headers=h1).json()["seats"] == [0]
    inv = client.get(f"/api/drops/{did}/invariants").json()
    assert inv["seat_mismatch"] == 0 and inv["held_mismatch"] == 0


def test_expired_offer_releases_its_seats(client, monkeypatch):
    did, offers = _drawn_drop(client, monkeypatch, users=1, wave_size=10)
    (_, h, oid), = offers
    _put(client, h, oid, [2])
    with psycopg.connect(TEST_URL, autocommit=True) as conn:
        conn.execute("UPDATE offers SET expires_at = now() - interval '1 second' WHERE offer_id=%s", (oid,))
        asyncio.run(_sweep_once(_Connection(conn)))
    assert _map(client, did) == ([], [])
    assert client.get(f"/api/drops/{did}/invariants").json()["seat_mismatch"] == 0


def test_bad_requests(client, monkeypatch):
    did, offers = _drawn_drop(client, monkeypatch, users=2, capacity=6, wave_size=10)
    (_, ha, a), (_, hb, b) = offers
    assert _put(client, ha, a, [1, 2]).json()["error"] == "too_many_seats"
    assert _put(client, ha, a, [6]).json()["error"] == "invalid_seat"
    assert _put(client, ha, a, [-1]).json()["error"] == "invalid_seat"
    r = _put(client, hb, a, [1])
    assert r.status_code == 403 and r.json()["error"] == "offer_not_yours"
    assert client.put(f"/api/offers/{a}/seats", json={"seats": [1]}).status_code == 401
    assert _put(client, ha, str(uuid.uuid4()), [1]).status_code == 404


def test_tier_only_drops_are_unchanged(client, monkeypatch):
    did, offers = _drawn_drop(client, monkeypatch, users=1, seat_selection=False)
    (_, h, oid), = offers
    assert _put(client, h, oid, [0]).json()["error"] == "seat_selection_disabled"
    assert client.post(f"/api/offers/{oid}/redeem", headers=h, json={"order_id": "o-" + oid}).status_code == 200


def test_database_refuses_double_lock_and_impossible_seats(client, monkeypatch):
    did, offers = _drawn_drop(client, monkeypatch, users=2, capacity=6, wave_size=10)
    (_, ha, a), (_, hb, b) = offers
    _put(client, ha, a, [1])
    with psycopg.connect(TEST_URL, autocommit=True) as conn:
        with pytest.raises(UniqueViolation):     # even code that skips the API can't double-lock
            conn.execute("INSERT INTO seat_assignments VALUES (%s,'gold',1,%s,'locked')", (did, b))
        with pytest.raises(CheckViolation):      # seat 6 does not exist in a 6-seat tier
            conn.execute("INSERT INTO seat_assignments VALUES (%s,'gold',6,%s,'locked')", (did, b))
        conn.execute("INSERT INTO seat_assignments VALUES (%s,'gold',2,%s,'locked')", (did, b))
        with pytest.raises(CheckViolation):      # quantity 1: a second seat for the same offer
            conn.execute("INSERT INTO seat_assignments VALUES (%s,'gold',3,%s,'locked')", (did, b))


def test_seat_settings_are_in_the_config_hash(client):
    base = drop_body(sybil_rules=[], seat_selection=True, seat_wave_size=10, seat_wave_s=20)
    fixed = {"drop_id": str(uuid.uuid4())}
    h1 = client.post("/api/admin/drops", headers=A, json={**base, **fixed}).json()["config_hash"]
    client.post("/api/admin/reset", headers=A, json={"seed_demo_drop": False})
    h2 = client.post("/api/admin/drops", headers=A, json={**base, **fixed, "seat_wave_s": 21}).json()["config_hash"]
    assert h1 != h2


def test_concurrent_clicks_on_one_seat_lock_it_exactly_once(live_server, monkeypatch):
    with httpx.Client(base_url=live_server.url, timeout=60) as c:
        did, offers = _drawn_drop(c, monkeypatch, users=24, capacity=30, wave_size=100)
    start = threading.Event()

    def click(o):
        _, h, oid = o
        start.wait()
        with httpx.Client(base_url=live_server.url, timeout=60) as hc:
            return hc.put(f"/api/offers/{oid}/seats", headers=h, json={"seats": [7]}).status_code

    with ThreadPoolExecutor(len(offers)) as ex:
        futs = [ex.submit(click, o) for o in offers]
        start.set()
        codes = [f.result() for f in futs]
    assert codes.count(200) == 1 and codes.count(409) == len(offers) - 1, codes
    with httpx.Client(base_url=live_server.url) as c:
        assert _map(c, did) == ([7], [])
