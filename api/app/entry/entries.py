"""Proof-of-work challenge and the entry endpoint.

Principle: every entry acknowledged to a client must appear in the sealed set, and
nothing accepted after the seal may. The shared/exclusive advisory fence enforces it:
an entry holds the fence shared for its whole transaction, and the seal's close step
takes it exclusive, so it waits for in-flight entries and blocks later ones until the
phase flip is committed.
"""
import re
import secrets
import uuid
from datetime import datetime

from fastapi import APIRouter, Depends, Request, Response
from pydantic import BaseModel, Field, field_validator

from fairdrop_common import crypto
from fairdrop_common import pow as fpow
from fairdrop_common.enums import ErrorCode, Phase

from ..db import get_pool
from ..errors import ApiError
from ..timefmt import iso_s, iso_us, parse_iso, utcnow
from . import turnstile
from .common import fence_key, load_drop
from .keys import get_keys
from .platform import Identity, current_identity
from .ratelimit import client_ip, limit, subnet_of, via_trusted_proxy

router = APIRouter(tags=["entries"])

WHOLE_SECOND_Z = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$")


@router.get("/api/drops/{drop_id}/pow-challenge")
def pow_challenge(drop_id: uuid.UUID, ident: Identity = Depends(current_identity)):
    with get_pool().connection() as conn:
        d = load_drop(conn, drop_id)
    if d["phase"] not in (Phase.scheduled, Phase.open) or utcnow() >= d["closes_at"]:
        raise ApiError(403, ErrorCode.window_closed, "registration is closed")
    issued_at = iso_s(utcnow())
    ch = fpow.challenge(get_keys().pow_hmac, drop_id, ident.identity_id, issued_at)
    return {"challenge": ch.hex(), "issued_at": issued_at, "bits": d["pow_bits"], "k": d["pow_k"],
            "memory_kib": d["pow_memory_kib"]}


class PowIn(BaseModel):
    issued_at: str
    nonces: list[int] = Field(max_length=64)

    @field_validator("issued_at")
    @classmethod
    def _iat(cls, v):
        if not WHOLE_SECOND_Z.match(v):
            raise ValueError("issued_at must be exactly as returned by /pow-challenge (YYYY-MM-DDTHH:MM:SSZ)")
        return v

    @field_validator("nonces")
    @classmethod
    def _range(cls, v):
        if any(n < 0 or n >= fpow.MAX_NONCE for n in v):
            raise ValueError("nonces must be in [0, 2^53)")
        return v


class EntryIn(BaseModel):
    tier_id: str = Field(max_length=32)
    quantity: int = Field(ge=1)
    turnstile_token: str | None = Field(default=None, max_length=4096)
    pow: PowIn | None = None


def _receipt(row: dict, config_hash: str) -> dict:
    receipt = {"drop_id": str(row["drop_id"]), "entry_id": row["entry_id"], "tier_id": row["tier_id"],
               "quantity": row["quantity"], "config_hash": config_hash,
               "accepted_at": iso_us(row["accepted_at"])}
    return {"entry_id": row["entry_id"], "receipt": receipt,
            "receipt_sig": crypto.sign_receipt(get_keys().receipt, receipt)}


@router.post("/api/drops/{drop_id}/entries", dependencies=[Depends(limit("entries"))])
def create_entry(drop_id: uuid.UUID, body: EntryIn, request: Request, response: Response,
                 ident: Identity = Depends(current_identity)):
    with get_pool().connection() as conn:
        d = load_drop(conn, drop_id)

    # a. Turnstile, outside any transaction.
    if d["turnstile_required"]:
        ip = client_ip(request) if via_trusted_proxy(request) else None
        if not turnstile.verify(body.turnstile_token, ip):
            raise ApiError(400, ErrorCode.turnstile_failed, "the human check failed; please try again")

    pow_issued_at: datetime | None = None
    nonces: list[int] | None = None
    if d["pow_required"] and body.pow is not None:
        pow_issued_at, nonces = parse_iso(body.pow.issued_at), body.pow.nonces

    entry_id = secrets.token_hex(16)
    with get_pool().connection() as conn, conn.transaction():
        # b. Shared fence; the seal's exclusive lock waits for us.
        conn.execute("SELECT pg_advisory_xact_lock_shared(%s)", (fence_key(drop_id),))
        # c. Phase and time, checked inside the lock.
        d = conn.execute(
            """SELECT phase, max_quantity, pow_k, pow_required, config_hash,
                      clock_timestamp() < closes_at AS before_close
                 FROM drops WHERE drop_id = %s""", (drop_id,)).fetchone()
        if d["phase"] != Phase.open or not d["before_close"]:
            raise ApiError(403, ErrorCode.window_closed, "registration is closed")
        # d. Tier, quantity, proof shape (no hashing here).
        if not conn.execute("SELECT 1 FROM tiers WHERE drop_id=%s AND tier_id=%s",
                            (drop_id, body.tier_id)).fetchone():
            raise ApiError(400, ErrorCode.unknown_tier, f"no tier {body.tier_id!r} in this drop")
        if body.quantity > d["max_quantity"]:
            raise ApiError(400, ErrorCode.quantity_exceeds_max, f"at most {d['max_quantity']} tickets per entry")
        if d["pow_required"] and nonces is None:
            raise ApiError(422, "invalid_request", "proof-of-work is required for this drop")
        if nonces is not None and len(nonces) != d["pow_k"]:
            raise ApiError(422, "invalid_request", f"proof must have exactly {d['pow_k']} nonces")
        # e/f. Risk facts from the verified token only; one entry per identity per drop.
        row = conn.execute(
            """INSERT INTO entries (entry_id, drop_id, identity_id, tier_id, quantity, account_created_at,
                                    device_hash, payment_fingerprint, pow_issued_at, pow_nonces, client_subnet)
               VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
               ON CONFLICT (drop_id, identity_id) DO NOTHING
               RETURNING entry_id, drop_id, tier_id, quantity, accepted_at""",
            (entry_id, drop_id, ident.identity_id, body.tier_id, body.quantity, ident.account_created_at,
             ident.device_hash, ident.payment_fingerprint, pow_issued_at, nonces,
             subnet_of(client_ip(request)))).fetchone()
        created = row is not None
        if not created:
            row = conn.execute(
                """SELECT entry_id, drop_id, tier_id, quantity, accepted_at FROM entries
                    WHERE drop_id=%s AND identity_id=%s""", (drop_id, ident.identity_id)).fetchone()
            if row["tier_id"] != body.tier_id or row["quantity"] != body.quantity:
                raise ApiError(409, ErrorCode.entry_exists_different_terms,
                               "you already entered this drop with a different tier or quantity")
        config_hash = d["config_hash"]

    # g. Signed receipt (Ed25519 is deterministic, so a retry gets the identical signature).
    response.status_code = 201 if created else 200
    return _receipt(row, config_hash)
