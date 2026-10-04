"""Admin: seal now (demo) and reset."""
import importlib.util
import uuid
from datetime import timedelta

from fastapi import APIRouter, Body, Depends, Response
from fastapi.concurrency import run_in_threadpool

from ..config import REPO_ROOT
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
        opens_at=now + timedelta(seconds=10), closes_at=now + timedelta(seconds=70),   # 60 s registration
        allocation_mode="lottery_wil", pow_required=True, turnstile_required=True, pow_bits=4,
        offer_ttl_s=60, pay_deadline_s=30, max_promotion_rounds=3,
        seat_selection=True, seat_wave_size=8, seat_wave_s=20,
        sybil_rules=[{"id": "device", "kind": "max_per_device", "limit": 2},
                     {"id": "payment", "kind": "max_per_payment", "limit": 2},
                     {"id": "fresh", "kind": "min_account_age_s", "value": 86400}],
        tiers=[{"tier_id": "gold", "name": "Gold", "price_paise": 450000, "capacity": 24},
               {"tier_id": "silver", "name": "Silver", "price_paise": 200000, "capacity": 60}],
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


@router.get("/api/admin/drops/{drop_id}/traffic")
def admin_traffic(drop_id: uuid.UUID, response: Response):
    """Entries grouped by /24 (/48) subnet. Operator hint only: never weighted, never published."""
    response.headers["Cache-Control"] = "private, no-store"
    with get_pool().connection() as conn:
        d = load_drop(conn, drop_id)
        # ponytail: top 1000 subnets by volume; paginate if a drop ever has more
        rows = conn.execute(
            """SELECT coalesce(client_subnet, 'unknown') AS subnet, count(*) AS entries,
                      count(DISTINCT device_hash) AS devices, count(DISTINCT payment_fingerprint) AS payments,
                      count(*) FILTER (WHERE eligible = false) AS excluded,
                      array_remove(array_agg(DISTINCT exclusion_reason), NULL) AS reasons,
                      min(accepted_at) AS first_at, max(accepted_at) AS last_at
                 FROM entries WHERE drop_id = %s GROUP BY 1 ORDER BY entries DESC, subnet LIMIT 1000""",
            (drop_id,)).fetchall()
    return {"drop_id": str(drop_id), "sealed": d["phase"] not in ("scheduled", "open"),
            "total": sum(r["entries"] for r in rows),
            "subnets": [{**r, "first_at": iso_s(r["first_at"]), "last_at": iso_s(r["last_at"])} for r in rows]}


@router.post("/api/admin/catalog")
def admin_catalog():
    """Same catalog as scripts/seed_catalog.py (imported, one source of truth). Idempotent."""
    spec = importlib.util.spec_from_file_location("seed_catalog", REPO_ROOT / "scripts" / "seed_catalog.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    created, skipped, ids = 0, 0, []
    with get_pool().connection() as conn:
        for body in mod.catalog(utcnow()):
            ids.append(body["drop_id"])
            if conn.execute("SELECT 1 FROM drops WHERE drop_id=%s", (body["drop_id"],)).fetchone():
                skipped += 1
                continue
            create_drop(conn, CreateDrop(**body))
            created += 1
        opened = conn.execute(
            "UPDATE drops SET phase='open' WHERE drop_id = ANY(%s::uuid[]) AND phase='scheduled' AND opens_at <= now()",
            (ids,)).rowcount
    return {"created": created, "skipped": skipped, "opened": opened}
