"""Razorpay Test Mode adapter used by the Member 3 payment lifecycle.

The secret remains server-side. This module deliberately uses the Orders API and
verifies both the checkout HMAC and the remote order/payment amounts before an
offer becomes confirmed.
"""

from __future__ import annotations

import asyncio
import base64
import hashlib
import hmac
import json
import os
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

API_BASE = "https://api.razorpay.com/v1"


class PaymentProviderError(RuntimeError):
    pass


def _credentials() -> tuple[str, str]:
    key_id = os.getenv("RAZORPAY_KEY_ID", "")
    key_secret = os.getenv("RAZORPAY_KEY_SECRET", "")
    if not key_id or not key_secret:
        raise PaymentProviderError("Razorpay Test Mode is not configured")
    return key_id, key_secret


def _request(method: str, path: str, payload: dict[str, Any] | None = None) -> dict[str, Any]:
    key_id, key_secret = _credentials()
    token = base64.b64encode(f"{key_id}:{key_secret}".encode("utf-8")).decode("ascii")
    body = json.dumps(payload).encode("utf-8") if payload is not None else None
    request = Request(
        f"{API_BASE}{path}", data=body, method=method,
        headers={"Authorization": f"Basic {token}", "Content-Type": "application/json"},
    )
    try:
        with urlopen(request, timeout=10) as response:
            result = json.load(response)
    except (HTTPError, URLError, json.JSONDecodeError) as exc:
        raise PaymentProviderError("Razorpay could not complete the request") from exc
    if not isinstance(result, dict):
        raise PaymentProviderError("Razorpay returned an invalid response")
    return result


async def create_order(*, offer_id: str, amount_paise: int) -> dict[str, Any]:
    key_id, _ = _credentials()
    # Receipt is an immutable, provider-side binding to this one Fair Drop offer.
    result = await asyncio.to_thread(
        _request, "POST", "/orders",
        {"amount": amount_paise, "currency": "INR", "receipt": f"fd_{offer_id.replace('-', '')}"},
    )
    if not isinstance(result.get("id"), str):
        raise PaymentProviderError("Razorpay did not create an order")
    return {"key_id": key_id, "provider_order_id": result["id"], "amount_paise": amount_paise,
            "currency": "INR"}


async def verify_payment(
    *, offer_id: str, amount_paise: int, provider_order_id: str,
    payment_id: str, signature: str,
) -> None:
    _key_id, key_secret = _credentials()
    expected = hmac.new(
        key_secret.encode("utf-8"), f"{provider_order_id}|{payment_id}".encode("utf-8"), hashlib.sha256,
    ).hexdigest()
    if not hmac.compare_digest(expected, signature):
        raise PaymentProviderError("Razorpay payment signature did not verify")

    order, payment = await asyncio.gather(
        asyncio.to_thread(_request, "GET", f"/orders/{provider_order_id}"),
        asyncio.to_thread(_request, "GET", f"/payments/{payment_id}"),
    )
    expected_receipt = f"fd_{offer_id.replace('-', '')}"
    if (order.get("receipt") != expected_receipt or order.get("amount") != amount_paise
            or order.get("currency") != "INR" or payment.get("order_id") != provider_order_id
            or payment.get("amount") != amount_paise or payment.get("currency") != "INR"
            or payment.get("status") != "captured"):
        raise PaymentProviderError("Razorpay payment does not match this offer")
