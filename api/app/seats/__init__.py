"""Seat selection after the lottery: winners pick exact seats in their won tier.

The lottery still decides who gets tickets and how many (per tier). This module only
lets a winner choose WHICH seats, during their rank-ordered wave:

  green  available   no seat_assignments row
  amber  locked      a row with status 'locked' (an offer is choosing or paying)
  red    booked      a row with status 'booked' (the offer is confirmed)

Correctness lives in the database (contracts/migrations/001_seats.sql): the primary key
(drop_id, tier_id, seat_index) means two offers can never hold the same seat, and
triggers book or release seats in the same transaction that changes the offer status.

Seat numbering: seat_index is 0-based and row-major in the venue layout that the
frontend draws (frontend/src/three/venue.js, layout(..., { unitSize: 1 })), so the
server never needs geometry; the frontend derives "Row r, Seat s" from the index.
"""
import uuid
from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, Response
from pydantic import BaseModel, Field

from ..db import get_pool
from ..entry.platform import Identity, current_identity
from ..errors import ApiError
from ..timefmt import iso_s, utcnow

router = APIRouter(tags=["seats"])


class SeatChoice(BaseModel):
    seats: list[int] = Field(max_length=4, description="0-based seat indexes in the offer's tier")


class _SeatTaken(Exception):
    def __init__(self, seats: list[int]):
        self.seats = seats


def _ts(dt: datetime | None) -> str | None:
    return iso_s(dt) if dt else None


@router.get("/api/drops/{drop_id}/seats")
def seat_map(drop_id: uuid.UUID, response: Response):
    """Public seat map: which seats are locked (amber) or booked (red), per tier.
    Owners are never revealed. Polled about every 2 s by people choosing seats."""
    with get_pool().connection() as conn:
        drop = conn.execute("SELECT seat_selection FROM drops WHERE drop_id=%s", (drop_id,)).fetchone()
        if drop is None:
            raise ApiError(404, "not_found", "no such drop")
        tiers = conn.execute("SELECT tier_id, capacity FROM tiers WHERE drop_id=%s ORDER BY tier_id",
                             (drop_id,)).fetchall()
        rows = conn.execute("""SELECT tier_id, seat_index, status FROM seat_assignments
                                WHERE drop_id=%s ORDER BY tier_id, seat_index""", (drop_id,)).fetchall()
    out = {t["tier_id"]: {"tier_id": t["tier_id"], "capacity": t["capacity"], "locked": [], "booked": []}
           for t in tiers}
    for r in rows:
        out[r["tier_id"]][r["status"]].append(r["seat_index"])
    response.headers["Cache-Control"] = "no-store"
    return {"drop_id": str(drop_id), "seat_selection": drop["seat_selection"],
            "server_time": iso_s(utcnow()), "tiers": list(out.values())}


_OFFER_SQL = """
    SELECT o.offer_id, o.drop_id, o.tier_id, o.quantity, o.round, o.status, o.expires_at,
           e.identity_id, d.seat_selection, d.offer_ttl_s, t.capacity, clock_timestamp() AS now
      FROM offers o
      JOIN entries e ON e.entry_id = o.entry_id
      JOIN drops d   ON d.drop_id = o.drop_id
      JOIN tiers t   ON t.drop_id = o.drop_id AND t.tier_id = o.tier_id
     WHERE o.offer_id = %s"""


def _load_offer(conn, offer_id, ident: Identity, *, for_update: bool = False) -> dict:
    o = conn.execute(_OFFER_SQL + (" FOR UPDATE OF o" if for_update else ""), (offer_id,)).fetchone()
    if o is None:
        raise ApiError(404, "not_found", "no such offer")
    if o["identity_id"] != ident.identity_id:
        raise ApiError(403, "offer_not_yours", "this offer belongs to another account")
    return o


def _offer_view(conn, o: dict) -> dict:
    mine = [r["seat_index"] for r in conn.execute(
        "SELECT seat_index FROM seat_assignments WHERE offer_id=%s ORDER BY seat_index", (o["offer_id"],))]
    # The seat window is the offer's own TTL: it opens offer_ttl_s before the deadline.
    # For round-0 offers the draw pushed the deadline back by the wave offset.
    opens = o["expires_at"] - _seconds(o["offer_ttl_s"])
    return {"offer_id": str(o["offer_id"]), "drop_id": str(o["drop_id"]), "tier_id": o["tier_id"],
            "quantity": o["quantity"], "round": o["round"], "status": o["status"],
            "seat_selection": o["seat_selection"], "seats": mine,
            "window_opens_at": _ts(opens), "window_closes_at": _ts(o["expires_at"]),
            "window_open": o["status"] == "offered" and opens <= o["now"] < o["expires_at"],
            "server_time": _ts(o["now"])}


def _seconds(n: int) -> timedelta:
    return timedelta(seconds=n)


@router.get("/api/offers/{offer_id}/seats")
def my_seats(offer_id: uuid.UUID, response: Response, ident: Identity = Depends(current_identity)):
    with get_pool().connection() as conn:
        view = _offer_view(conn, _load_offer(conn, offer_id, ident))
    response.headers["Cache-Control"] = "no-store"
    return view


@router.put("/api/offers/{offer_id}/seats")
def choose_seats(offer_id: uuid.UUID, body: SeatChoice, ident: Identity = Depends(current_identity)):
    """Replace this offer's seat choice with `seats` (0..quantity seats), atomically.

    Every newly chosen seat is locked (amber) for this offer; seats dropped from the
    choice are released. If any newly chosen seat is already locked or booked by
    someone else, nothing changes and the answer is 409 seat_taken with those seats.
    """
    want = list(dict.fromkeys(body.seats))          # de-duplicate, keep order
    with get_pool().connection() as conn:
        try:
            with conn.transaction():
                o = _load_offer(conn, offer_id, ident, for_update=True)
                if not o["seat_selection"]:
                    raise ApiError(409, "seat_selection_disabled", "this drop allocates seats by tier only")
                if o["status"] != "offered":
                    raise ApiError(409, "not_offered", "seats can only change before you press Buy")
                opens = o["expires_at"] - _seconds(o["offer_ttl_s"])
                if o["now"] < opens:
                    raise ApiError(409, "seat_window_not_open", "your seat-choice window has not opened yet",
                                   opens_at=_ts(opens))
                if o["now"] >= o["expires_at"]:
                    raise ApiError(409, "offer_expired", "this offer has expired")
                if len(want) > o["quantity"]:
                    raise ApiError(400, "too_many_seats", f"choose at most {o['quantity']} seat(s)")
                if any(s < 0 or s >= o["capacity"] for s in want):
                    raise ApiError(400, "invalid_seat", f"seats in this tier are numbered 0..{o['capacity'] - 1}")

                mine = {r["seat_index"] for r in conn.execute(
                    "SELECT seat_index FROM seat_assignments WHERE offer_id=%s", (offer_id,))}
                release = sorted(mine - set(want))
                add = [s for s in want if s not in mine]
                if release:
                    conn.execute("DELETE FROM seat_assignments WHERE offer_id=%s AND seat_index = ANY(%s)",
                                 (offer_id, release))
                if add:
                    got = {r["seat_index"] for r in conn.execute(
                        """INSERT INTO seat_assignments (drop_id, tier_id, seat_index, offer_id, status)
                           SELECT %s, %s, s, %s, 'locked' FROM unnest(%s::int[]) AS s
                           ON CONFLICT (drop_id, tier_id, seat_index) DO NOTHING
                           RETURNING seat_index""",
                        (o["drop_id"], o["tier_id"], offer_id, add))}
                    taken = sorted(set(add) - got)
                    if taken:
                        raise _SeatTaken(taken)          # rolls back the whole change
                view = _offer_view(conn, o)
        except _SeatTaken as e:
            raise ApiError(409, "seat_taken", "someone else has just locked or booked that seat",
                           seats=e.seats) from None
    return view
