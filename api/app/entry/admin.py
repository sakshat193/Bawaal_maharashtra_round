"""Admin: seal now (demo) and reset."""
import uuid
from datetime import timedelta

from fastapi import APIRouter, Body, Depends
from fastapi.concurrency import run_in_threadpool

from ..db import get_pool
from ..errors import ApiError
from ..timefmt import iso_s, utcnow
from . import seal as sealmod
from .admin_auth import require_admin
from .common import load_drop
from .drops import CreateDrop, create_drop, drop_detail

router = APIRouter(tags=["admin"], dependencies=[Depends(require_admin)])


@router.post("/api/admin/drops/{drop_id}/seal")
async def admin_seal(drop_id: uuid.UUID):
    """Idempotent: seals, resumes an interrupted seal, or retries a failed timestamp."""
    with get_pool().connection() as conn:
        load_drop(conn, drop_id)
    try:
        r = await run_in_threadpool(sealmod.seal, drop_id)
    except sealmod.SealGuardError as e:
        raise ApiError(409, "conflict", str(e)) from None
    except sealmod.SealError as e:
        raise ApiError(409, "conflict", str(e)) from None
    return {"drop_id": r.drop_id, "canonical_hash": r.canonical_hash, "exclusions_hash": r.exclusions_hash,
            "eligible": r.eligible, "excluded": r.excluded, "timestamped_at": iso_s(r.timestamped_at)}


def demo_drop_request() -> CreateDrop:
    """Short demo timings (see the plan's open questions); shown on the demo panel."""
    now = utcnow().replace(microsecond=0)
    return CreateDrop(
        name="Fair Drop Live", venue="Demo Arena", starts_at=now + timedelta(days=30),
        opens_at=now + timedelta(seconds=10), closes_at=now + timedelta(minutes=3),
        allocation_mode="lottery_wil", pow_required=True, turnstile_required=True, pow_bits=4,
        offer_ttl_s=60, pay_deadline_s=30, max_promotion_rounds=3,
        seat_selection=True, seat_wave_size=10, seat_wave_s=20,
        sybil_rules=[{"id": "device", "kind": "max_per_device", "limit": 2},
                     {"id": "payment", "kind": "max_per_payment", "limit": 2},
                     {"id": "fresh", "kind": "min_account_age_s", "value": 86400}],
        tiers=[{"tier_id": "gold", "name": "Gold", "price_paise": 450000, "capacity": 100},
               {"tier_id": "silver", "name": "Silver", "price_paise": 200000, "capacity": 300}],
    )


@router.post("/api/admin/reset")
def admin_reset(body: dict = Body(default={})):
    with get_pool().connection() as conn:
        with conn.transaction():
            conn.execute("TRUNCATE offers, ranks, draws, snapshots, entries, tiers, drops CASCADE")
        out = {"reset": True, "drop": None}
        if body.get("seed_demo_drop", True):
            out["drop"] = drop_detail(conn, create_drop(conn, demo_drop_request()))
        return out
