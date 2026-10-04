"""Allocation, offer lifecycle, and public evidence endpoints (Member 3)."""

import asyncio
import logging
import uuid
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Depends
from psycopg.rows import tuple_row

from ..db import get_pool
from ..config import get_settings
from ..entry import Identity, current_identity
from ..entry.admin_auth import require_admin
from ..errors import ApiError
from fairdrop_common.drand import fetch as fetch_drand, time_of
from fairdrop_common._compat import canonical
from fairdrop_common.rank import fcfs_order, lottery_order
from .payments import PaymentProviderError, create_order, verify_payment

logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app):
    task = asyncio.create_task(background()) if get_settings().scheduler_enabled else None
    try:
        yield
    finally:
        if task is not None:
            task.cancel()
            try:
                await task
            except asyncio.CancelledError:
                pass


router = APIRouter(prefix="/api", lifespan=lifespan)


class _Cursor:
    def __init__(self, cursor: Any):
        self.cursor = cursor

    async def fetchone(self):
        return self.cursor.fetchone()

    async def fetchall(self):
        return self.cursor.fetchall()


class _Transaction:
    def __init__(self, transaction: Any):
        self.transaction = transaction

    async def __aenter__(self):
        self.transaction.__enter__()

    async def __aexit__(self, *args):
        return self.transaction.__exit__(*args)


class _Connection:
    """Async-shaped adapter over Member 2's synchronous psycopg pool connection."""
    def __init__(self, connection: Any):
        self.connection = connection

    async def execute(self, sql: str, params: tuple = ()) -> _Cursor:
        cursor = self.connection.cursor(row_factory=tuple_row)
        cursor.execute(sql, params)
        return _Cursor(cursor)

    def transaction(self) -> _Transaction:
        return _Transaction(self.connection.transaction())


def conn():
    with get_pool().connection() as connection:
        yield _Connection(connection)


def _now() -> datetime:
    return datetime.now(timezone.utc)


async def _one(connection: Any, sql: str, params: tuple = ()) -> tuple | None:
    cursor = await connection.execute(sql, params)
    return await cursor.fetchone()


async def _all(connection: Any, sql: str, params: tuple = ()) -> list[tuple]:
    cursor = await connection.execute(sql, params)
    return await cursor.fetchall()


@router.get("/drops/{drop_id}/me", operation_id="getMe")
async def get_me(
    drop_id: uuid.UUID,
    identity: Identity = Depends(current_identity),
    connection: Any = Depends(conn),
) -> dict[str, Any]:
    row = await _one(
        connection,
        """SELECT d.phase, e.entry_id, e.tier_id, e.quantity, e.eligible,
                  e.exclusion_reason, r.rank,
                  o.offer_id, o.round, o.status, o.expires_at, o.pay_deadline,
                  t.price_paise, d.closes_at
             FROM drops d
             LEFT JOIN entries e ON e.drop_id = d.drop_id AND e.identity_id = %s
             LEFT JOIN ranks r ON r.drop_id = e.drop_id AND r.entry_id = e.entry_id
             LEFT JOIN offers o ON o.drop_id = e.drop_id AND o.entry_id = e.entry_id
             LEFT JOIN tiers t ON t.drop_id = e.drop_id AND t.tier_id = e.tier_id
            WHERE d.drop_id = %s""",
        (identity.identity_id, drop_id),
    )
    if row is None:
        raise ApiError(404, "not_found")
    (phase, entry_id, tier_id, quantity, eligible, exclusion_reason, rank,
     offer_id, offer_round, offer_status, expires_at, pay_deadline,
     price_paise, closes_at) = row
    result: dict[str, Any] = {"phase": phase, "server_time": _now().isoformat().replace("+00:00", "Z"),
                              "entry": None, "offer": None}
    if entry_id is None:
        return result

    if exclusion_reason:
        status = "excluded"
    elif phase in ("scheduled", "open", "sealed"):
        status = "registered"
    elif offer_id is not None:
        status = offer_status
    elif phase == "settled":
        status = "not_selected"
    else:
        status = "waitlisted"

    waitlist_position = None
    if status == "waitlisted" and rank is not None:
        pos = await _one(
            connection,
            """SELECT count(*) + 1 FROM ranks r
                 JOIN entries e ON e.entry_id = r.entry_id
                WHERE r.drop_id = %s AND e.tier_id = %s AND r.rank < %s
                  AND NOT EXISTS (SELECT 1 FROM offers o WHERE o.entry_id = e.entry_id)""",
            (drop_id, tier_id, rank),
        )
        waitlist_position = pos[0] if pos else None

    result["entry"] = {
        "entry_id": entry_id, "tier_id": tier_id, "quantity": quantity,
        "status": status, "rank": rank, "waitlist_position": waitlist_position,
        "exclusion_reason": exclusion_reason,
    }
    if offer_id is not None:
        result["offer"] = {
            "offer_id": str(offer_id), "tier_id": tier_id, "quantity": quantity,
            "amount_paise": quantity * price_paise, "round": offer_round,
            "status": offer_status, "expires_at": expires_at.isoformat().replace("+00:00", "Z"),
            "pay_deadline": pay_deadline.isoformat().replace("+00:00", "Z") if pay_deadline else None,
        }
    return result


@router.post("/offers/{offer_id}/redeem", operation_id="redeemOffer")
async def redeem_offer(
    offer_id: uuid.UUID,
    body: dict[str, str],
    identity: Identity = Depends(current_identity),
    connection: Any = Depends(conn),
) -> dict[str, Any]:
    order_id = body.get("order_id", "")
    if not order_id or len(order_id) > 128:
        raise ApiError(400, "invalid_request")
    async with connection.transaction():
        row = await _one(
            connection,
            """SELECT o.status, o.order_id, o.expires_at, o.pay_deadline,
                      e.identity_id, d.pay_deadline_s
                 FROM offers o JOIN entries e ON e.entry_id = o.entry_id
                 JOIN drops d ON d.drop_id = o.drop_id
                WHERE o.offer_id = %s FOR UPDATE OF o""",
            (offer_id,),
        )
        if row is None:
            raise ApiError(409, "not_offered")
        status, saved_order, expires_at, pay_deadline, owner_id, pay_seconds = row
        if owner_id != identity.identity_id:
            raise ApiError(403, "offer_not_yours")
        if status in ("payment_pending", "confirmed"):
            if saved_order == order_id:
                return {"offer_id": str(offer_id), "order_id": order_id,
                        "status": status, "pay_deadline": pay_deadline.isoformat().replace("+00:00", "Z") if pay_deadline else None}
            raise ApiError(409, "already_redeemed_other_order")
        if status != "offered":
            raise ApiError(409, "not_offered")
        if expires_at <= _now():
            raise ApiError(409, "offer_expired")
        cursor = await connection.execute(
            """UPDATE offers SET status='payment_pending', order_id=%s,
                      pay_deadline=clock_timestamp() + make_interval(secs => %s)
                 WHERE offer_id=%s AND status='offered' RETURNING pay_deadline""",
            (order_id, pay_seconds, offer_id),
        )
        updated = await cursor.fetchone()
        if updated is None:
            raise ApiError(409, "not_offered")
        return {"offer_id": str(offer_id), "order_id": order_id,
                "status": "payment_pending", "pay_deadline": updated[0].isoformat().replace("+00:00", "Z")}


@router.post("/offers/{offer_id}/pay", operation_id="payOffer")
async def pay_offer(
    offer_id: uuid.UUID,
    body: dict[str, str],
    identity: Identity = Depends(current_identity),
    connection: Any = Depends(conn),
) -> dict[str, Any]:
    order_id, result = body.get("order_id", ""), body.get("result", "")
    provider = body.get("provider", "mock")
    if not order_id or (provider == "mock" and result not in {"success", "fail"}):
        raise ApiError(400, "invalid_request")
    async with connection.transaction():
        row = await _one(
            connection,
            """SELECT o.status, o.order_id, o.pay_deadline, o.quantity, o.drop_id,
                      o.tier_id, e.identity_id
                 FROM offers o JOIN entries e ON e.entry_id=o.entry_id
                WHERE o.offer_id=%s FOR UPDATE OF o""",
            (offer_id,),
        )
        if row is None:
            raise ApiError(404, "not_found")
        status, saved_order, deadline, quantity, drop_id, tier_id, owner_id = row
        if owner_id != identity.identity_id:
            raise ApiError(403, "offer_not_yours")
        if status != "payment_pending" or saved_order != order_id:
            raise ApiError(409, "not_payment_pending")
        if deadline <= _now():
            if result == "success":
                raise ApiError(409, "payment_window_closed", refund=True)
            raise ApiError(409, "payment_window_closed")
        if provider == "razorpay":
            provider_order_id = body.get("razorpay_order_id", "")
            payment_id = body.get("razorpay_payment_id", "")
            signature = body.get("razorpay_signature", "")
            if not provider_order_id or not payment_id or not signature:
                raise ApiError(400, "invalid_request")
            amount = await _one(connection,
                "SELECT price_paise * %s FROM tiers WHERE drop_id=%s AND tier_id=%s",
                (quantity, drop_id, tier_id))
            try:
                await verify_payment(
                    offer_id=str(offer_id), amount_paise=amount[0], provider_order_id=provider_order_id,
                    payment_id=payment_id, signature=signature,
                )
            except PaymentProviderError as exc:
                raise ApiError(409, "payment_unavailable", message=str(exc)) from exc
            result = "success"
        elif provider != "mock":
            raise ApiError(400, "invalid_request")
        if result == "success":
            await connection.execute(
                "UPDATE offers SET status='confirmed', confirmed_at=clock_timestamp() WHERE offer_id=%s",
                (offer_id,),
            )
            return {"status": "confirmed"}
        await connection.execute("UPDATE offers SET status='payment_failed' WHERE offer_id=%s", (offer_id,))
        await connection.execute(
            "UPDATE tiers SET held=held-%s WHERE drop_id=%s AND tier_id=%s",
            (quantity, drop_id, tier_id),
        )
        return {"status": "payment_failed"}


@router.post("/offers/{offer_id}/checkout", operation_id="createPaymentCheckout")
async def create_payment_checkout(
    offer_id: uuid.UUID,
    identity: Identity = Depends(current_identity),
    connection: Any = Depends(conn),
) -> dict[str, Any]:
    """Create a Razorpay Test Mode order for a redeemed offer.

    The browser passes this response to Razorpay Checkout, then submits the
    returned payment identifiers to ``/pay`` with ``provider: razorpay``.
    """
    row = await _one(
        connection,
        """SELECT o.status,o.pay_deadline,o.quantity,o.drop_id,o.tier_id,e.identity_id,t.price_paise
             FROM offers o JOIN entries e ON e.entry_id=o.entry_id
             JOIN tiers t ON t.drop_id=o.drop_id AND t.tier_id=o.tier_id
            WHERE o.offer_id=%s""", (offer_id,),
    )
    if row is None:
        raise ApiError(404, "not_found")
    status, pay_deadline, quantity, _drop_id, _tier_id, owner_id, price_paise = row
    if owner_id != identity.identity_id:
        raise ApiError(403, "offer_not_yours")
    if status != "payment_pending" or pay_deadline <= _now():
        raise ApiError(409, "not_payment_pending")
    try:
        checkout = await create_order(offer_id=str(offer_id), amount_paise=quantity * price_paise)
    except PaymentProviderError as exc:
        raise ApiError(503, "payment_unavailable", message=str(exc)) from exc
    return {"provider": "razorpay", **checkout,
            "pay_deadline": pay_deadline.isoformat().replace("+00:00", "Z")}


@router.post("/offers/{offer_id}/decline", operation_id="declineOffer")
async def decline_offer(
    offer_id: uuid.UUID,
    identity: Identity = Depends(current_identity),
    connection: Any = Depends(conn),
) -> dict[str, Any]:
    async with connection.transaction():
        row = await _one(
            connection,
            """SELECT o.status,o.quantity,o.drop_id,o.tier_id,e.identity_id
                 FROM offers o JOIN entries e ON e.entry_id=o.entry_id
                WHERE o.offer_id=%s FOR UPDATE OF o""",
            (offer_id,),
        )
        if row is None:
            raise ApiError(404, "not_found")
        status, quantity, drop_id, tier_id, owner_id = row
        if owner_id != identity.identity_id:
            raise ApiError(403, "offer_not_yours")
        if status != "offered":
            raise ApiError(409, "not_offered")
        await connection.execute("UPDATE offers SET status='declined' WHERE offer_id=%s", (offer_id,))
        await connection.execute("UPDATE tiers SET held=held-%s WHERE drop_id=%s AND tier_id=%s",
                                 (quantity, drop_id, tier_id))
    return {"status": "declined"}


@router.get("/drops/{drop_id}/draw", operation_id="getDraw")
async def get_draw(drop_id: uuid.UUID, connection: Any = Depends(conn)) -> dict[str, Any]:
    draw = await _one(connection,
        "SELECT drand_round,signature,randomness,relays,drawn_at FROM draws WHERE drop_id=%s", (drop_id,))
    if draw is None:
        raise ApiError(404, "not_found")
    round_number, signature, randomness, relays, drawn_at = draw
    ranks = await _all(connection,
        "SELECT entry_id,rank FROM ranks WHERE drop_id=%s ORDER BY rank", (drop_id,))
    offers = await _all(connection,
        """SELECT entry_id,tier_id,quantity,round,offer_id FROM offers
            WHERE drop_id=%s AND round=0 ORDER BY (SELECT rank FROM ranks r WHERE r.entry_id=offers.entry_id)""",
        (drop_id,))
    return {"drop_id": str(drop_id), "round": round_number, "signature": signature,
            "randomness": randomness, "relays": relays,
            "drawn_at": drawn_at.isoformat().replace("+00:00", "Z"),
            "ranked_entry_ids": [r[0] for r in ranks],
            "allocation": [{"entry_id": r[0], "tier_id": r[1], "quantity": r[2],
                            "round": r[3], "offer_id": str(r[4])} for r in offers]}


@router.get("/drops/{drop_id}/invariants", operation_id="getInvariants")
async def invariants(drop_id: uuid.UUID, connection: Any = Depends(conn)) -> dict[str, Any]:
    tiers = await _all(connection,
        """SELECT t.tier_id,t.held,t.capacity,
                  COALESCE(sum(o.quantity) FILTER (WHERE o.status IN ('offered','payment_pending','confirmed')),0)
             FROM tiers t LEFT JOIN offers o ON o.drop_id=t.drop_id AND o.tier_id=t.tier_id
            WHERE t.drop_id=%s GROUP BY t.tier_id,t.held,t.capacity ORDER BY t.tier_id""", (drop_id,))
    double_offers = await _one(connection,
        "SELECT count(*) FROM (SELECT entry_id FROM offers WHERE drop_id=%s GROUP BY entry_id HAVING count(*)>1) q",
        (drop_id,))
    if not tiers:
        raise ApiError(404, "not_found")
    return {"tiers": [{"tier_id": r[0], "held": r[1], "active_offer_units": int(r[3]),
                        "capacity": r[2]} for r in tiers],
            "oversell": sum(max(0, r[1]-r[2]) for r in tiers),
            "held_mismatch": sum(abs(r[1]-int(r[3])) for r in tiers),
            "double_redemption": int(double_offers[0])}


@router.post("/admin/drops/{drop_id}/draw", operation_id="adminDraw")
async def admin_draw(
    drop_id: uuid.UUID,
    _admin: Any = Depends(require_admin),
    connection: Any = Depends(conn),
) -> dict[str, Any]:
    await _draw_drop(connection, drop_id)
    return await get_draw(drop_id, connection)


@router.get("/admin/drops/{drop_id}/outcomes", operation_id="adminOutcomes")
async def admin_outcomes(
    drop_id: uuid.UUID,
    _admin: Any = Depends(require_admin),
    connection: Any = Depends(conn),
) -> dict[str, Any]:
    rows = await _all(connection,
        """SELECT e.entry_id,e.identity_id,e.quantity,
                  CASE WHEN e.exclusion_reason IS NOT NULL THEN 'excluded'
                       WHEN o.status IS NOT NULL THEN o.status
                       WHEN d.phase='settled' THEN 'not_selected'
                       WHEN r.rank IS NOT NULL THEN 'waitlisted'
                       ELSE 'registered' END AS status
             FROM entries e JOIN drops d USING(drop_id)
             LEFT JOIN ranks r ON r.drop_id=e.drop_id AND r.entry_id=e.entry_id
             LEFT JOIN offers o ON o.drop_id=e.drop_id AND o.entry_id=e.entry_id
            WHERE e.drop_id=%s ORDER BY e.entry_id""", (drop_id,))
    return {"drop_id": str(drop_id), "outcomes": [
        {"entry_id": r[0], "identity_id": r[1], "quantity": r[2], "status": r[3]} for r in rows
    ]}


async def _draw_drop(connection: Any, drop_id: uuid.UUID) -> bool:
    """Draw one sealed drop. Snapshot bytes are the only entry source."""
    async with connection.transaction():
        lock = await _one(connection, "SELECT pg_try_advisory_xact_lock(hashtextextended(%s,0))", (f"draw:{drop_id}",))
        if not lock or not lock[0]:
            return False
        existing = await _one(connection, "SELECT 1 FROM draws WHERE drop_id=%s", (drop_id,))
        if existing:
            return False
        row = await _one(connection,
            """SELECT d.drand_round,d.phase,s.canonical_blob,s.timestamp_proof,s.timestamped_at,d.allocation_mode
                 FROM drops d JOIN snapshots s USING(drop_id) WHERE d.drop_id=%s FOR UPDATE OF d""", (drop_id,))
        if row is None:
            return False
        round_number, phase, blob, proof, timestamped_at, allocation_mode = row
        if phase != "sealed" or not proof or not timestamped_at or timestamped_at >= datetime.fromtimestamp(time_of(round_number), timezone.utc):
            return False

    # Do not hold a database transaction open while polling external relays.
    beacon = await fetch_drand(round_number)
    _header, entries = canonical.parse_snapshot(bytes(blob))
    if not isinstance(entries, list):
        raise ValueError("snapshot entries must be a list")
    if allocation_mode == "fcfs":
        ranked = fcfs_order(entries)
    elif allocation_mode == "lottery_wil":
        ranked = lottery_order(entries, drop_id, beacon["randomness"])
    else:
        raise ValueError(f"unknown allocation mode: {allocation_mode!r}")
    async with connection.transaction():
        lock = await _one(connection, "SELECT pg_try_advisory_xact_lock(hashtextextended(%s,0))", (f"draw:{drop_id}",))
        if not lock or not lock[0] or await _one(connection, "SELECT 1 FROM draws WHERE drop_id=%s", (drop_id,)):
            return False
        # Recheck the seal guard after network I/O, then commit all allocation state atomically.
        guard = await _one(connection,
            """SELECT d.phase,s.timestamp_proof,s.timestamped_at FROM drops d JOIN snapshots s USING(drop_id)
                WHERE d.drop_id=%s FOR UPDATE OF d""", (drop_id,))
        if guard is None or guard[0] != "sealed" or not guard[1] or not guard[2] or guard[2] >= datetime.fromtimestamp(time_of(round_number), timezone.utc):
            return False
        await connection.execute(
            "INSERT INTO draws(drop_id,drand_round,signature,randomness,relays,drawn_at) VALUES(%s,%s,%s,%s,%s,clock_timestamp())",
            (drop_id, round_number, beacon["signature"], beacon["randomness"], list(DRAND_RELAY_NAMES)),
        )
        for position, entry in enumerate(ranked, 1):
            await connection.execute("INSERT INTO ranks(drop_id,entry_id,rank) VALUES(%s,%s,%s)",
                                     (drop_id, entry["entry_id"], position))
        tier_rows = await _all(connection,
            "SELECT tier_id,capacity,held FROM tiers WHERE drop_id=%s ORDER BY tier_id FOR UPDATE", (drop_id,))
        remaining = {tier: capacity-held for tier, capacity, held in tier_rows}
        for entry in ranked:
            tier_id, quantity = entry["tier_id"], entry["quantity"]
            if remaining.get(tier_id, 0) < quantity:
                continue
            offer_id = uuid.uuid4()
            await connection.execute(
                """INSERT INTO offers(offer_id,drop_id,entry_id,tier_id,quantity,round,status,expires_at)
                   VALUES(%s,%s,%s,%s,%s,0,'offered',clock_timestamp()+make_interval(secs =>
                     (SELECT offer_ttl_s FROM drops WHERE drop_id=%s)))""",
                (offer_id, drop_id, entry["entry_id"], tier_id, quantity, drop_id),
            )
            await connection.execute("UPDATE tiers SET held=held+%s WHERE drop_id=%s AND tier_id=%s",
                                     (quantity, drop_id, tier_id))
            remaining[tier_id] -= quantity
        await connection.execute("UPDATE drops SET phase='drawn' WHERE drop_id=%s AND phase='sealed'", (drop_id,))
    return True


DRAND_RELAY_NAMES = ("api.drand.sh", "drand.cloudflare.com")


async def _sweep_once(connection: Any) -> None:
    async with connection.transaction():
        lock = await _one(connection, "SELECT pg_try_advisory_xact_lock(hashtextextended('allocation-sweeper',0))")
        if not lock or not lock[0]:
            return
        expired = await _all(connection,
            """UPDATE offers SET status='expired' WHERE status='offered' AND expires_at<=clock_timestamp()
               RETURNING drop_id,tier_id,quantity""")
        failed = await _all(connection,
            """UPDATE offers SET status='payment_failed' WHERE status='payment_pending' AND pay_deadline<=clock_timestamp()
               RETURNING drop_id,tier_id,quantity""")
        for drop_id, tier_id, quantity in expired + failed:
            await connection.execute("UPDATE tiers SET held=held-%s WHERE drop_id=%s AND tier_id=%s",
                                     (quantity, drop_id, tier_id))

    # Promotion is performed one drop at a time, in rank order, with row locks.
    drops = await _all(connection, "SELECT drop_id,max_promotion_rounds FROM drops WHERE phase='drawn' ORDER BY drop_id")
    for drop_id, max_rounds in drops:
        async with connection.transaction():
            lock = await _one(connection,
                "SELECT pg_try_advisory_xact_lock(hashtextextended(%s,0))", (f"promotion:{drop_id}",))
            if not lock or not lock[0]:
                continue
            tier_rows = await _all(connection,
                "SELECT tier_id,capacity,held FROM tiers WHERE drop_id=%s ORDER BY tier_id FOR UPDATE", (drop_id,))
            for tier_id, capacity, held in tier_rows:
                free = capacity - held
                if free <= 0:
                    continue
                max_round = await _one(connection,
                    "SELECT COALESCE(max(round),0) FROM offers WHERE drop_id=%s AND tier_id=%s", (drop_id, tier_id))
                round_number = max_round[0] + 1
                if round_number > max_rounds:
                    continue
                candidates = await _all(connection,
                    """SELECT e.entry_id,e.quantity,r.rank FROM entries e JOIN ranks r USING(entry_id)
                        WHERE e.drop_id=%s AND e.tier_id=%s AND NOT EXISTS
                          (SELECT 1 FROM offers o WHERE o.drop_id=e.drop_id AND o.entry_id=e.entry_id)
                        ORDER BY r.rank FOR UPDATE OF e SKIP LOCKED""", (drop_id, tier_id))
                for entry_id, quantity, _rank in candidates:
                    if quantity > free:
                        continue
                    await connection.execute(
                        """INSERT INTO offers(offer_id,drop_id,entry_id,tier_id,quantity,round,status,expires_at)
                           VALUES(%s,%s,%s,%s,%s,%s,'offered',clock_timestamp()+make_interval(secs =>
                             (SELECT offer_ttl_s FROM drops WHERE drop_id=%s)))""",
                        (uuid.uuid4(), drop_id, entry_id, tier_id, quantity, round_number, drop_id),
                    )
                    await connection.execute("UPDATE tiers SET held=held+%s WHERE drop_id=%s AND tier_id=%s",
                                             (quantity, drop_id, tier_id))
                    free -= quantity
            # No live offer means promotion has no further fitting entry to advance.
            # Release leftover inventory to the explicitly labelled FCFS pool and settle.
            active = await _one(connection,
                "SELECT count(*) FROM offers WHERE drop_id=%s AND status IN ('offered','payment_pending')",
                (drop_id,))
            if active and active[0] == 0:
                await connection.execute(
                    "UPDATE tiers SET general_sale_units=general_sale_units+(capacity-held) WHERE drop_id=%s",
                    (drop_id,),
                )
                await connection.execute("UPDATE drops SET phase='settled' WHERE drop_id=%s", (drop_id,))


async def background() -> None:
    """Restart-safe draw and offer sweeper. Each iteration is idempotent."""
    while True:
        try:
            with get_pool().connection() as raw_connection:
                connection = _Connection(raw_connection)
                sealed = await _all(connection,
                    """SELECT d.drop_id FROM drops d JOIN snapshots s USING(drop_id)
                        WHERE d.phase='sealed' AND s.timestamp_proof IS NOT NULL AND s.timestamped_at IS NOT NULL
                          AND s.timestamped_at < to_timestamp((d.drand_round - 1)*3 + 1692803367)""")
                for (drop_id,) in sealed:
                    try:
                        await _draw_drop(connection, drop_id)
                    except Exception:
                        logger.exception("allocation draw failed for %s", drop_id)
                await _sweep_once(connection)
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception("allocation background iteration failed")
        await asyncio.sleep(2)


