"""Drop creation (admin) and the public drop list/detail."""
import re
import uuid
from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, Response
from psycopg.types.json import Jsonb
from pydantic import BaseModel, Field, field_validator, model_validator

from fairdrop_common._compat import drand
from fairdrop_common.enums import AllocationMode, SybilRuleKind

from ..config import get_settings
from ..db import get_pool
from ..errors import ApiError
from ..timefmt import from_unix, iso_s, utcnow
from .admin_auth import require_admin
from .common import compute_config_hash, load_drop, load_tiers, round_due_unix

router = APIRouter(tags=["drops"])

ID_RE = re.compile(r"^[a-z0-9_-]{1,32}$")


class TierIn(BaseModel):
    tier_id: str
    name: str = Field(min_length=1, max_length=64)
    price_paise: int = Field(ge=0)
    capacity: int = Field(ge=0)

    @field_validator("tier_id")
    @classmethod
    def _tid(cls, v):
        if not ID_RE.match(v):
            raise ValueError("tier_id must match [a-z0-9_-]{1,32}")
        return v


class CreateDrop(BaseModel):
    drop_id: uuid.UUID | None = None
    name: str = Field(min_length=1, max_length=200)
    venue: str = Field(min_length=1, max_length=200)
    starts_at: datetime
    opens_at: datetime
    closes_at: datetime
    allocation_mode: AllocationMode
    pow_required: bool
    turnstile_required: bool
    pow_bits: int = Field(ge=0, le=24)
    pow_k: int = Field(default=16, ge=1, le=64)
    pow_memory_kib: int = Field(default=2048, ge=8, le=262144)
    max_quantity: int = Field(default=4, ge=1, le=4)
    offer_ttl_s: int = Field(default=600, ge=1)
    pay_deadline_s: int = Field(default=300, ge=1)
    max_promotion_rounds: int = Field(default=6, ge=0, le=100)
    sybil_rules: list[dict] = Field(default_factory=list)
    tiers: list[TierIn] = Field(min_length=1)

    @field_validator("starts_at", "opens_at", "closes_at")
    @classmethod
    def _aware(cls, v: datetime):
        if v.tzinfo is None:
            raise ValueError("timestamps must include a timezone (use Z)")
        return v.replace(microsecond=0)  # whole seconds: what is stored is what is hashed

    @field_validator("sybil_rules")
    @classmethod
    def _rules(cls, rules):
        kinds = {k.value for k in SybilRuleKind}
        seen = set()
        for r in rules:
            kind = r.get("kind")
            if kind not in kinds:
                raise ValueError(f"unknown sybil rule kind {kind!r}; allowed: {sorted(kinds)}")
            rid = r.get("id")
            if not isinstance(rid, str) or not ID_RE.match(rid) or rid in seen:
                raise ValueError(f"sybil rule id {rid!r} must be unique and match [a-z0-9_-]{{1,32}}")
            seen.add(rid)
            param = "value" if kind == "min_account_age_s" else "limit"
            if set(r) != {"id", "kind", param}:
                raise ValueError(f"rule {rid}: fields must be exactly id, kind, {param}")
            v = r[param]
            if not isinstance(v, int) or isinstance(v, bool) or v < (0 if param == "value" else 1):
                raise ValueError(f"rule {rid}: {param} must be an integer >= {0 if param == 'value' else 1}")
        return rules

    @model_validator(mode="after")
    def _window(self):
        if self.opens_at >= self.closes_at:
            raise ValueError("opens_at must be before closes_at")
        ids = [t.tier_id for t in self.tiers]
        if len(set(ids)) != len(ids):
            raise ValueError("tier_id values must be unique")
        return self


def create_drop(conn, req: CreateDrop) -> uuid.UUID:
    s = get_settings()
    drop_id = req.drop_id or uuid.uuid4()
    r = drand.round_at(req.closes_at + timedelta(seconds=s.drand_margin_s))
    drop = req.model_dump(exclude={"tiers"})
    drop.update(drop_id=drop_id, drand_chain=drand.CHAIN, drand_round=r,
                allocation_mode=req.allocation_mode.value)
    tiers = [t.model_dump() for t in req.tiers]
    drop["config_hash"] = compute_config_hash(drop, tiers)
    with conn.transaction():
        conn.execute(
            """INSERT INTO drops (drop_id, name, venue, starts_at, opens_at, closes_at, allocation_mode,
                 pow_required, turnstile_required, pow_bits, pow_k, pow_memory_kib, max_quantity,
                 offer_ttl_s, pay_deadline_s, max_promotion_rounds, sybil_rules, drand_chain,
                 drand_round, config_hash)
               VALUES (%(drop_id)s, %(name)s, %(venue)s, %(starts_at)s, %(opens_at)s, %(closes_at)s,
                 %(allocation_mode)s, %(pow_required)s, %(turnstile_required)s, %(pow_bits)s, %(pow_k)s,
                 %(pow_memory_kib)s, %(max_quantity)s, %(offer_ttl_s)s, %(pay_deadline_s)s,
                 %(max_promotion_rounds)s, %(sybil_rules_json)s, %(drand_chain)s, %(drand_round)s,
                 %(config_hash)s)""",
            {**drop, "sybil_rules_json": Jsonb(drop["sybil_rules"])},
        )
        with conn.cursor() as cur:
            cur.executemany(
                "INSERT INTO tiers (drop_id, tier_id, name, price_paise, capacity) VALUES (%s,%s,%s,%s,%s)",
                [(drop_id, t["tier_id"], t["name"], t["price_paise"], t["capacity"]) for t in tiers],
            )
    return drop_id


def _summary(d: dict) -> dict:
    return {"drop_id": str(d["drop_id"]), "name": d["name"], "venue": d["venue"],
            "starts_at": iso_s(d["starts_at"]), "opens_at": iso_s(d["opens_at"]),
            "closes_at": iso_s(d["closes_at"]), "phase": d["phase"], "allocation_mode": d["allocation_mode"]}


def drop_detail(conn, drop_id) -> dict:
    d = load_drop(conn, drop_id)
    tiers = load_tiers(conn, drop_id)
    c = conn.execute(
        """SELECT count(*) AS entries,
                  count(*) FILTER (WHERE eligible) AS eligible,
                  count(*) FILTER (WHERE eligible = false) AS excluded
             FROM entries WHERE drop_id = %s""", (drop_id,)).fetchone()
    snap = conn.execute(
        "SELECT canonical_hash, exclusions_hash, sealed_at, timestamped_at FROM snapshots WHERE drop_id = %s",
        (drop_id,)).fetchone()
    sealed = snap is not None
    out = _summary(d)
    out.update({
        "tiers": [{"tier_id": t["tier_id"], "name": t["name"], "price_paise": t["price_paise"],
                   "capacity": t["capacity"]} for t in tiers],
        **{k: d[k] for k in ("pow_required", "turnstile_required", "pow_bits", "pow_k", "pow_memory_kib",
                             "max_quantity", "offer_ttl_s", "pay_deadline_s", "max_promotion_rounds",
                             "sybil_rules", "config_hash", "drand_chain", "drand_round")},
        "config_hash": d["config_hash"].strip(),
        "drand_round_due_at": iso_s(from_unix(round_due_unix(d))),
        "server_time": iso_s(utcnow()),
        "counts": {"entries": c["entries"],
                   "eligible": c["eligible"] if sealed else None,
                   "excluded": c["excluded"] if sealed else None},
        "snapshot": None if not sealed else {
            "canonical_hash": snap["canonical_hash"], "exclusions_hash": snap["exclusions_hash"],
            "sealed_at": iso_s(snap["sealed_at"]),
            "timestamped_at": iso_s(snap["timestamped_at"]) if snap["timestamped_at"] else None,
        },
    })
    return out


@router.get("/api/drops")
def list_drops(response: Response):
    with get_pool().connection() as conn:
        rows = conn.execute("SELECT * FROM drops ORDER BY opens_at, drop_id").fetchall()
    response.headers["Cache-Control"] = "public, max-age=5, s-maxage=5"
    return {"server_time": iso_s(utcnow()), "drops": [_summary(r) for r in rows]}


@router.get("/api/drops/{drop_id}")
def get_drop(drop_id: uuid.UUID, response: Response):
    with get_pool().connection() as conn:
        out = drop_detail(conn, drop_id)
    response.headers["Cache-Control"] = "public, max-age=2, s-maxage=2"
    return out


@router.post("/api/admin/drops", status_code=201, dependencies=[Depends(require_admin)])
def admin_create_drop(req: CreateDrop):
    with get_pool().connection() as conn:
        if req.drop_id and conn.execute("SELECT 1 FROM drops WHERE drop_id=%s", (req.drop_id,)).fetchone():
            raise ApiError(409, "conflict", "drop_id already exists")
        drop_id = create_drop(conn, req)
        return drop_detail(conn, drop_id)


@router.post("/api/admin/drops/{drop_id}/open", dependencies=[Depends(require_admin)])
def admin_open(drop_id: uuid.UUID):
    with get_pool().connection() as conn:
        load_drop(conn, drop_id)
        row = conn.execute(
            "UPDATE drops SET phase='open' WHERE drop_id=%s AND phase='scheduled' RETURNING phase",
            (drop_id,)).fetchone()
        if row is None:
            raise ApiError(409, "conflict", "drop is not in phase 'scheduled'")
        return drop_detail(conn, drop_id)
