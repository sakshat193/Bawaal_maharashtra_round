"""Member 3 offer lifecycle checks against the shared Postgres schema."""

import asyncio
import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from threading import Event

import httpx
import psycopg
import pytest
from psycopg.errors import CheckViolation

from app import alloc as alloc_module
from app.alloc import _Connection, _draw_drop, _sweep_once
from fairdrop_common.drand import time_of
from fairdrop_common.canonical import snapshot_bytes

from .conftest import TEST_URL, A, drop_body


def _seed_offer(base_url, *, status="offered", expires_in=300, pay_deadline_in=None):
    with httpx.Client(base_url=base_url, timeout=30) as client:
        created = client.post(
            "/api/admin/drops", headers=A,
            json=drop_body(sybil_rules=[], offer_ttl_s=300, pay_deadline_s=300),
        )
        assert created.status_code == 201, created.text
        drop_id = created.json()["drop_id"]
        opened = client.post(f"/api/admin/drops/{drop_id}/open", headers=A)
        assert opened.status_code == 200, opened.text
        token_response = client.post("/platform/login", json={"username": f"alloc-{uuid.uuid4().hex}"})
        assert token_response.status_code == 200, token_response.text
        headers = {"Authorization": f"Bearer {token_response.json()['token']}"}
        entry_response = client.post(
            f"/api/drops/{drop_id}/entries", headers=headers,
            json={"tier_id": "gold", "quantity": 1},
        )
        assert entry_response.status_code == 201, entry_response.text

    offer_id = uuid.uuid4()
    order_id = str(uuid.uuid4()) if status == "payment_pending" else None
    now = datetime.now(timezone.utc)
    expires_at = now + timedelta(seconds=expires_in)
    pay_deadline = (now + timedelta(seconds=pay_deadline_in)
                    if pay_deadline_in is not None else None)
    with psycopg.connect(TEST_URL) as connection:
        connection.execute("UPDATE drops SET phase='drawn' WHERE drop_id=%s", (drop_id,))
        connection.execute("UPDATE tiers SET held=held+1 WHERE drop_id=%s AND tier_id='gold'", (drop_id,))
        connection.execute(
            """INSERT INTO offers(offer_id,drop_id,entry_id,tier_id,quantity,round,status,
                       expires_at,pay_deadline,order_id)
                 VALUES(%s,%s,%s,'gold',1,0,%s,%s,%s,%s)""",
            (offer_id, drop_id, entry_response.json()["entry_id"], status,
             expires_at, pay_deadline, order_id),
        )
    return {"offer_id": str(offer_id), "drop_id": drop_id, "headers": headers, "order_id": order_id}


def _sweep_once_in_new_connection():
    with psycopg.connect(TEST_URL) as connection:
        asyncio.run(_sweep_once(_Connection(connection)))


def _seed_ranked_drop(base_url, *, quantities, capacity, max_rounds=3, active_first=True):
    tiers = [
        {"tier_id": "gold", "name": "Gold", "price_paise": 450000, "capacity": capacity},
        {"tier_id": "silver", "name": "Silver", "price_paise": 200000, "capacity": 0},
    ]
    with httpx.Client(base_url=base_url, timeout=30) as client:
        created = client.post(
            "/api/admin/drops", headers=A,
            json=drop_body(sybil_rules=[], max_promotion_rounds=max_rounds, tiers=tiers),
        )
        assert created.status_code == 201, created.text
        drop_id = created.json()["drop_id"]
        opened = client.post(f"/api/admin/drops/{drop_id}/open", headers=A)
        assert opened.status_code == 200, opened.text
        entry_ids = []
        for index, quantity in enumerate(quantities):
            login = client.post("/platform/login", json={"username": f"rank-{uuid.uuid4().hex}"})
            assert login.status_code == 200, login.text
            response = client.post(
                f"/api/drops/{drop_id}/entries",
                headers={"Authorization": f"Bearer {login.json()['token']}"},
                json={"tier_id": "gold", "quantity": quantity},
            )
            assert response.status_code == 201, response.text
            entry_ids.append(response.json()["entry_id"])

    now = datetime.now(timezone.utc)
    active_offer_id = uuid.uuid4() if active_first else None
    with psycopg.connect(TEST_URL) as connection:
        connection.execute("UPDATE drops SET phase='drawn' WHERE drop_id=%s", (drop_id,))
        connection.cursor().executemany(
            "INSERT INTO ranks(drop_id,entry_id,rank) VALUES(%s,%s,%s)",
            [(drop_id, entry_id, rank) for rank, entry_id in enumerate(entry_ids, 1)],
        )
        if active_offer_id is not None:
            connection.execute(
                "UPDATE tiers SET held=%s WHERE drop_id=%s AND tier_id='gold'",
                (quantities[0], drop_id),
            )
            connection.execute(
                """INSERT INTO offers(offer_id,drop_id,entry_id,tier_id,quantity,round,status,
                           expires_at,pay_deadline,order_id)
                     VALUES(%s,%s,%s,'gold',%s,0,'payment_pending',%s,%s,%s)""",
                (active_offer_id, drop_id, entry_ids[0], quantities[0],
                 now + timedelta(minutes=5), now + timedelta(minutes=5), str(uuid.uuid4())),
            )
    return {"drop_id": drop_id, "entry_ids": entry_ids, "active_offer_id": active_offer_id}


def _seed_sealed_drop(base_url, *, late_proof=False, missing_proof=False):
    with httpx.Client(base_url=base_url, timeout=30) as client:
        created = client.post("/api/admin/drops", headers=A, json=drop_body(sybil_rules=[]))
        assert created.status_code == 201, created.text
        drop_id = created.json()["drop_id"]
        opened = client.post(f"/api/admin/drops/{drop_id}/open", headers=A)
        assert opened.status_code == 200, opened.text
        token = client.post("/platform/login", json={"username": f"draw-{uuid.uuid4().hex}"})
        assert token.status_code == 200, token.text
        entry = client.post(
            f"/api/drops/{drop_id}/entries",
            headers={"Authorization": f"Bearer {token.json()['token']}"},
            json={"tier_id": "gold", "quantity": 1},
        )
        assert entry.status_code == 201, entry.text

    entry_id = entry.json()["entry_id"]
    now = datetime.now(timezone.utc)
    with psycopg.connect(TEST_URL) as connection:
        round_number = connection.execute(
            "SELECT drand_round FROM drops WHERE drop_id=%s", (drop_id,)
        ).fetchone()[0]
        due_at = datetime.fromtimestamp(time_of(round_number), timezone.utc)
        timestamped_at = (None if missing_proof else
                  due_at + timedelta(seconds=1) if late_proof else now)
        header = {
            "config_hash": "0" * 64,
            "drand_round": round_number,
            "drop_id": drop_id,
            "exclusions_hash": "0" * 64,
            "version": "fairdrop-snapshot/2",
        }
        snapshot = snapshot_bytes(header, [{"accepted_at": now, "entry_id": entry_id,
                                           "quantity": 1, "tier_id": "gold"}])
        connection.execute("UPDATE drops SET phase='sealed' WHERE drop_id=%s", (drop_id,))
        connection.execute(
            """INSERT INTO snapshots(drop_id,sealed_at,entry_count,canonical_blob,canonical_hash,
                       exclusions_blob,exclusions_hash,timestamp_proof,timestamped_at)
                  VALUES(%s,%s,1,%s,%s,%s,%s,%s,%s)""",
              (drop_id, now, snapshot, "0" * 64, b"", "0" * 64,
               None if missing_proof else "test-proof", timestamped_at),
        )
    return {"drop_id": drop_id, "round": round_number}


def test_fifty_concurrent_redeems_create_one_payment_order(live_server):
    offer = _seed_offer(live_server.url)
    start = Event()

    def redeem(index):
        start.wait()
        with httpx.Client(base_url=live_server.url, timeout=30) as client:
            return client.post(
                f"/api/offers/{offer['offer_id']}/redeem", headers=offer["headers"],
                json={"order_id": f"race-{index}"},
            )

    with ThreadPoolExecutor(max_workers=50) as executor:
        futures = [executor.submit(redeem, index) for index in range(50)]
        start.set()
        responses = [future.result() for future in futures]

    successes = [response for response in responses if response.status_code == 200]
    conflicts = [response for response in responses if response.status_code == 409]
    assert len(successes) == 1
    assert len(conflicts) == 49
    assert all(response.json()["error"] == "already_redeemed_other_order" for response in conflicts)
    with psycopg.connect(TEST_URL) as connection:
        state = connection.execute(
            "SELECT status,order_id FROM offers WHERE offer_id=%s", (offer["offer_id"],)
        ).fetchone()
        held = connection.execute(
            "SELECT held FROM tiers WHERE drop_id=%s AND tier_id='gold'", (offer["drop_id"],)
        ).fetchone()[0]
    assert state == ("payment_pending", successes[0].json()["order_id"])
    assert held == 1


def test_expired_offer_racing_redeem_and_sweeper_releases_inventory(live_server):
    offer = _seed_offer(live_server.url, expires_in=-1)
    start = Event()

    def redeem():
        start.wait()
        with httpx.Client(base_url=live_server.url, timeout=30) as client:
            return client.post(
                f"/api/offers/{offer['offer_id']}/redeem", headers=offer["headers"],
                json={"order_id": "expiry-race"},
            )

    with ThreadPoolExecutor(max_workers=2) as executor:
        redemption = executor.submit(redeem)
        sweep = executor.submit(lambda: (start.wait(), _sweep_once_in_new_connection()))
        start.set()
        response = redemption.result()
        sweep.result()

    assert response.status_code == 409
    assert response.json()["error"] in {"offer_expired", "not_offered"}
    with psycopg.connect(TEST_URL) as connection:
        status, held = connection.execute(
            """SELECT o.status,t.held FROM offers o JOIN tiers t USING(drop_id,tier_id)
                WHERE o.offer_id=%s""", (offer["offer_id"],)
        ).fetchone()
    assert status == "expired"
    assert held == 0


def test_payment_before_deadline_confirms_offer(live_server):
    offer = _seed_offer(live_server.url, status="payment_pending", pay_deadline_in=300)
    with httpx.Client(base_url=live_server.url, timeout=30) as client:
        response = client.post(
            f"/api/offers/{offer['offer_id']}/pay", headers=offer["headers"],
            json={"order_id": offer["order_id"], "result": "success"},
        )
    assert response.status_code == 200, response.text
    assert response.json() == {"status": "confirmed"}
    with psycopg.connect(TEST_URL) as connection:
        status, held = connection.execute(
            """SELECT o.status,t.held FROM offers o JOIN tiers t USING(drop_id,tier_id)
                WHERE o.offer_id=%s""", (offer["offer_id"],)
        ).fetchone()
    assert (status, held) == ("confirmed", 1)


def test_late_payment_is_rejected_then_sweeper_releases_inventory(live_server):
    offer = _seed_offer(live_server.url, status="payment_pending", pay_deadline_in=-1)
    with httpx.Client(base_url=live_server.url, timeout=30) as client:
        response = client.post(
            f"/api/offers/{offer['offer_id']}/pay", headers=offer["headers"],
            json={"order_id": offer["order_id"], "result": "success"},
        )
    assert response.status_code == 409
    assert response.json()["error"] == "payment_window_closed"
    assert response.json()["refund"] is True
    _sweep_once_in_new_connection()
    with psycopg.connect(TEST_URL) as connection:
        status, held = connection.execute(
            """SELECT o.status,t.held FROM offers o JOIN tiers t USING(drop_id,tier_id)
                WHERE o.offer_id=%s""", (offer["offer_id"],)
        ).fetchone()
    assert (status, held) == ("payment_failed", 0)


def test_payment_racing_expired_deadline_and_sweeper_has_one_terminal_state(live_server):
    offer = _seed_offer(live_server.url, status="payment_pending", pay_deadline_in=-1)
    start = Event()

    def pay():
        start.wait()
        with httpx.Client(base_url=live_server.url, timeout=30) as client:
            return client.post(
                f"/api/offers/{offer['offer_id']}/pay", headers=offer["headers"],
                json={"order_id": offer["order_id"], "result": "success"},
            )

    with ThreadPoolExecutor(max_workers=2) as executor:
        payment = executor.submit(pay)
        sweep = executor.submit(lambda: (start.wait(), _sweep_once_in_new_connection()))
        start.set()
        response = payment.result()
        sweep.result()

    assert response.status_code == 409
    assert response.json()["error"] in {"payment_window_closed", "not_payment_pending"}
    with psycopg.connect(TEST_URL) as connection:
        status, held = connection.execute(
            """SELECT o.status,t.held FROM offers o JOIN tiers t USING(drop_id,tier_id)
                WHERE o.offer_id=%s""", (offer["offer_id"],)
        ).fetchone()
    assert (status, held) == ("payment_failed", 0)


def test_shared_schema_rejects_held_above_capacity(live_server):
    offer = _seed_offer(live_server.url)
    with psycopg.connect(TEST_URL) as connection:
        with pytest.raises(CheckViolation):
            with connection.transaction():
                connection.execute(
                    """UPDATE tiers SET held=capacity+1
                        WHERE drop_id=%s AND tier_id='gold'""", (offer["drop_id"],)
                )


def test_promotion_skips_non_fitting_entry_and_preserves_rank_order(live_server):
    drop = _seed_ranked_drop(
        live_server.url, quantities=[1, 2, 1], capacity=2, active_first=True,
    )
    _sweep_once_in_new_connection()
    with psycopg.connect(TEST_URL) as connection:
        offers = connection.execute(
            "SELECT entry_id,round FROM offers WHERE drop_id=%s ORDER BY round,entry_id",
            (drop["drop_id"],),
        ).fetchall()
        held = connection.execute(
            "SELECT held FROM tiers WHERE drop_id=%s AND tier_id='gold'", (drop["drop_id"],)
        ).fetchone()[0]
    assert offers == [
        (drop["entry_ids"][0], 0),
        (drop["entry_ids"][2], 1),
    ]
    assert held == 2


def test_promotion_cap_releases_unused_units_to_general_sale(live_server):
    drop = _seed_ranked_drop(
        live_server.url, quantities=[1, 1], capacity=1, max_rounds=1, active_first=False,
    )
    _sweep_once_in_new_connection()
    with psycopg.connect(TEST_URL) as connection:
        promoted_id = connection.execute(
            "SELECT offer_id FROM offers WHERE drop_id=%s", (drop["drop_id"],)
        ).fetchone()[0]
        connection.execute(
            "UPDATE offers SET status='declined' WHERE offer_id=%s", (promoted_id,)
        )
        connection.execute(
            "UPDATE tiers SET held=held-1 WHERE drop_id=%s AND tier_id='gold'", (drop["drop_id"],)
        )

    _sweep_once_in_new_connection()
    with psycopg.connect(TEST_URL) as connection:
        phase = connection.execute(
            "SELECT phase FROM drops WHERE drop_id=%s", (drop["drop_id"],)
        ).fetchone()[0]
        held, general_sale = connection.execute(
            "SELECT held,general_sale_units FROM tiers WHERE drop_id=%s AND tier_id='gold'",
            (drop["drop_id"],),
        ).fetchone()
        unoffered_entry_count = connection.execute(
            """SELECT count(*) FROM entries e WHERE e.drop_id=%s AND NOT EXISTS
                    (SELECT 1 FROM offers o WHERE o.entry_id=e.entry_id)""",
            (drop["drop_id"],),
        ).fetchone()[0]
    assert phase == "settled"
    assert (held, general_sale, unoffered_entry_count) == (0, 1, 1)


def test_draw_rejects_timestamp_proof_after_beacon_deadline(live_server, monkeypatch):
    drop = _seed_sealed_drop(live_server.url, late_proof=True)

    async def unexpected_fetch(_round_number):
        raise AssertionError("late snapshots must be rejected before drand is fetched")

    monkeypatch.setattr(alloc_module, "fetch_drand", unexpected_fetch)
    with psycopg.connect(TEST_URL, autocommit=True) as connection:
        drawn = asyncio.run(_draw_drop(_Connection(connection), uuid.UUID(drop["drop_id"])))
        count = connection.execute(
            "SELECT count(*) FROM draws WHERE drop_id=%s", (drop["drop_id"],)
        ).fetchone()[0]
    assert not drawn
    assert count == 0


def test_draw_rejects_snapshot_without_timestamp_proof(live_server, monkeypatch):
    drop = _seed_sealed_drop(live_server.url, missing_proof=True)

    async def unexpected_fetch(_round_number):
        raise AssertionError("unstamped snapshots must be rejected before drand is fetched")

    monkeypatch.setattr(alloc_module, "fetch_drand", unexpected_fetch)
    with psycopg.connect(TEST_URL, autocommit=True) as connection:
        drawn = asyncio.run(_draw_drop(_Connection(connection), uuid.UUID(drop["drop_id"])))
        count = connection.execute(
            "SELECT count(*) FROM draws WHERE drop_id=%s", (drop["drop_id"],)
        ).fetchone()[0]
    assert not drawn
    assert count == 0


def test_draw_is_idempotent_for_one_sealed_snapshot(live_server, monkeypatch):
    drop = _seed_sealed_drop(live_server.url)

    async def fake_fetch(round_number):
        assert round_number == drop["round"]
        return {"signature": "ab", "randomness": "cd" * 32}

    monkeypatch.setattr(alloc_module, "fetch_drand", fake_fetch)
    with psycopg.connect(TEST_URL, autocommit=True) as connection:
        adapter = _Connection(connection)
        first = asyncio.run(_draw_drop(adapter, uuid.UUID(drop["drop_id"])))
        second = asyncio.run(_draw_drop(adapter, uuid.UUID(drop["drop_id"])))
        counts = connection.execute(
            """SELECT (SELECT count(*) FROM draws WHERE drop_id=%s),
                      (SELECT count(*) FROM ranks WHERE drop_id=%s),
                      (SELECT count(*) FROM offers WHERE drop_id=%s)""",
            (drop["drop_id"], drop["drop_id"], drop["drop_id"]),
        ).fetchone()
    assert first and not second
    assert counts == (1, 1, 1)
