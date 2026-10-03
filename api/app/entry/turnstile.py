"""Cloudflare Turnstile siteverify. Defence in depth, never the fairness mechanism.

Always called OUTSIDE any database transaction so no lock is held across a network call.
"""
import uuid

import httpx

from ..config import TURNSTILE_TEST_SECRET, get_settings

SITEVERIFY = "https://challenges.cloudflare.com/turnstile/v0/siteverify"
EXPECTED_ACTION = "enter"


def verify(token: str | None, remote_ip: str | None = None, *, client: httpx.Client | None = None) -> bool:
    """remote_ip is passed only when the request came through a configured trusted proxy."""
    s = get_settings()
    if not token:
        return False
    data = {"secret": s.turnstile_secret, "response": token, "idempotency_key": str(uuid.uuid4())}
    if remote_ip:
        data["remoteip"] = remote_ip
    try:
        c = client or httpx.Client(timeout=5.0)
        try:
            r = c.post(SITEVERIFY, data=data)
        finally:
            if client is None:
                c.close()
        body = r.json()
    except (httpx.HTTPError, ValueError):
        return False
    if body.get("success") is not True:
        return False
    # Cloudflare's test secrets answer with placeholder hostname/action; only the real
    # secret gets the strict checks.
    if s.turnstile_secret == TURNSTILE_TEST_SECRET:
        return True
    if s.turnstile_hostnames and body.get("hostname") not in s.turnstile_hostnames:
        return False
    return body.get("action") == EXPECTED_ACTION
