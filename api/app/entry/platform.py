"""Mock identity platform and the current_identity() dependency every private route uses.

The platform owns identity: it signs an EdDSA JWT carrying three risk facts. Fair Drop
only ever reads risk facts from a verified token, never from a request body.
"""
import hashlib
import hmac
import secrets
from dataclasses import dataclass
from datetime import datetime, timedelta

import jwt
from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel, Field

from ..config import get_settings
from ..errors import ApiError
from ..timefmt import iso_s, parse_iso, utcnow
from .keys import get_keys
from .ratelimit import limit

ISSUER = "mock-platform"
AUDIENCE = "fairdrop"
MAX_LIFETIME_S = 15 * 60
LEEWAY_S = 5

router = APIRouter(tags=["platform"])


class LoginRequest(BaseModel):
    username: str = Field(min_length=1, max_length=64)
    # DEMO_MODE only (harness risk knobs); ignored otherwise.
    device_hash: str | None = Field(default=None, max_length=128)
    payment_fingerprint: str | None = Field(default=None, max_length=128)
    account_age_days: int | None = Field(default=None, ge=0, le=36500)


@dataclass(frozen=True)
class Identity:
    identity_id: str
    account_created_at: datetime | None
    device_hash: str | None
    payment_fingerprint: str | None


def _hmac_hex(label: str, username: str) -> str:
    return hmac.new(get_keys().platform_hmac, f"{label}|{username}".encode(), hashlib.sha256).hexdigest()


def identity_id_for(username: str) -> str:
    """Stable without a users table: "id_" + HMAC(platform_key, username)[:16]."""
    return "id_" + hmac.new(get_keys().platform_hmac, username.encode(), hashlib.sha256).hexdigest()[:16]


def _platform_records(username: str, now: datetime) -> tuple[datetime, str, str]:
    """What a real platform would look up. Deterministic per username so retries agree."""
    h = _hmac_hex("account", username)
    age_days = 400 + int(h[:4], 16) % 2000          # established accounts, 400..2399 days old
    created = (now - timedelta(days=age_days)).replace(hour=0, minute=0, second=0, microsecond=0)
    return created, "dev_" + _hmac_hex("device", username)[:16], "pay_" + _hmac_hex("payment", username)[:16]


def issue_token(req: LoginRequest) -> tuple[str, str, datetime]:
    s = get_settings()
    now = utcnow().replace(microsecond=0)
    created, device, payment = _platform_records(req.username, now)
    # DEMO_MODE lets the harness choose risk facts. A real platform would never take
    # these from the client; with DEMO_MODE off the body fields are ignored.
    if s.demo_mode:
        if req.account_age_days is not None:
            created = now - timedelta(days=req.account_age_days)
        device = req.device_hash if req.device_hash is not None else device
        payment = req.payment_fingerprint if req.payment_fingerprint is not None else payment
    ident = identity_id_for(req.username)
    exp = now + timedelta(seconds=min(s.jwt_ttl_s, MAX_LIFETIME_S))
    claims = {
        "iss": ISSUER, "aud": AUDIENCE, "sub": ident, "identity_id": ident,
        "iat": int(now.timestamp()), "exp": int(exp.timestamp()), "nonce": secrets.token_hex(12),
        "account_created_at": iso_s(created), "device_hash": device, "payment_fingerprint": payment,
    }
    return jwt.encode(claims, get_keys().platform, algorithm="EdDSA"), ident, exp


@router.post("/platform/login", dependencies=[Depends(limit("login"))])
def login(req: LoginRequest):
    token, ident, exp = issue_token(req)
    return {"token": token, "identity_id": ident, "expires_at": iso_s(exp)}


def decode_identity(token: str) -> Identity:
    """Verify an identity JWT. Algorithm, issuer, audience and lifetime are pinned; the
    key comes from configuration only, never from anything inside the token."""
    try:
        claims = jwt.decode(
            token, get_keys().platform_pub, algorithms=["EdDSA"], audience=AUDIENCE, issuer=ISSUER,
            leeway=LEEWAY_S,
            options={"require": ["iss", "aud", "sub", "iat", "exp", "nonce", "identity_id"]},
        )
    except jwt.PyJWTError as e:
        raise ApiError(401, "unauthorized", f"invalid identity token: {e}") from None
    iat, exp = claims["iat"], claims["exp"]
    if not isinstance(iat, int) or not isinstance(exp, int) or exp - iat > MAX_LIFETIME_S:
        raise ApiError(401, "unauthorized", "identity token lifetime exceeds 15 minutes")
    if iat > utcnow().timestamp() + LEEWAY_S:
        raise ApiError(401, "unauthorized", "identity token issued in the future")
    ident = claims["identity_id"]
    if not isinstance(ident, str) or claims["sub"] != ident:
        raise ApiError(401, "unauthorized", "identity token subject mismatch")
    try:
        created = parse_iso(claims["account_created_at"]) if claims.get("account_created_at") else None
    except (TypeError, ValueError):
        raise ApiError(401, "unauthorized", "bad account_created_at claim") from None
    return Identity(ident, created, claims.get("device_hash"), claims.get("payment_fingerprint"))


def current_identity(request: Request) -> Identity:
    """FastAPI dependency for every private route (Member 2 and Member 3).
    In tests, replace it with app.dependency_overrides[current_identity] = lambda: Identity(...)."""
    auth = request.headers.get("authorization", "")
    scheme, _, token = auth.partition(" ")
    if scheme.lower() != "bearer" or not token:
        raise ApiError(401, "unauthorized", "missing Authorization: Bearer <identity JWT>")
    return decode_identity(token.strip())
