"""Loopback-only Razorpay Test Mode adapter for frontend checkout testing."""

from __future__ import annotations

import ipaddress
import uuid

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from app.alloc.payments import PaymentProviderError, create_order, verify_payment

app = FastAPI(title="Fair Drop Razorpay test checkout")
TEST_AMOUNT_PAISE = 100
_orders: dict[str, str] = {}


class PaymentResult(BaseModel):
    test_offer_id: str = Field(min_length=1, max_length=64)
    razorpay_order_id: str = Field(min_length=1, max_length=128)
    razorpay_payment_id: str = Field(min_length=1, max_length=128)
    razorpay_signature: str = Field(min_length=1, max_length=256)


def _require_loopback(request: Request) -> None:
    host = request.client.host if request.client else ""
    try:
        allowed = ipaddress.ip_address(host).is_loopback
    except ValueError:
        allowed = False
    if not allowed:
        raise PermissionError("The payment test endpoint only accepts local requests.")


@app.post("/order")
async def create_test_order(request: Request):
    try:
        _require_loopback(request)
        test_offer_id = str(uuid.uuid4())
        order = await create_order(offer_id=test_offer_id, amount_paise=TEST_AMOUNT_PAISE)
        _orders[order["provider_order_id"]] = test_offer_id
        return {**order, "test_offer_id": test_offer_id}
    except PermissionError as exc:
        return JSONResponse({"error": "local_only", "message": str(exc)}, status_code=403)
    except PaymentProviderError as exc:
        return JSONResponse({"error": "payment_unavailable", "message": str(exc)}, status_code=503)


@app.post("/verify")
async def verify_test_payment(result: PaymentResult, request: Request):
    try:
        _require_loopback(request)
        offer_id = _orders.get(result.razorpay_order_id)
        if offer_id != result.test_offer_id:
            return JSONResponse({"error": "invalid_order", "message": "This test order was not created here."}, status_code=400)
        await verify_payment(
            offer_id=offer_id,
            amount_paise=TEST_AMOUNT_PAISE,
            provider_order_id=result.razorpay_order_id,
            payment_id=result.razorpay_payment_id,
            signature=result.razorpay_signature,
        )
        _orders.pop(result.razorpay_order_id, None)
        return {"status": "confirmed"}
    except PermissionError as exc:
        return JSONResponse({"error": "local_only", "message": str(exc)}, status_code=403)
    except PaymentProviderError as exc:
        return JSONResponse({"error": "payment_unverified", "message": str(exc)}, status_code=409)