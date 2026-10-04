"""Run the six post-draw adversarial/recovery interactions."""

from __future__ import annotations

import asyncio
import json
import uuid
from datetime import datetime, timezone

from .api import FairDropApi, bearer_token


def _offer(payload: dict) -> dict | None:
    offer = payload.get("offer")
    if isinstance(offer, dict) and offer.get("offer_id"):
        return offer
    return None


async def _me(api: FairDropApi, drop_id: str, user: dict) -> dict:
    return await api.checked(
        "GET", f"/api/drops/{drop_id}/me", token=user["token"]
    )


async def _redeem(api: FairDropApi, offer_id: str, token: str, order_id: str):
    return await api.request(
        "POST", f"/api/offers/{offer_id}/redeem", token=token, body={"order_id": order_id}
    )


def _result(passed: bool, expected: str, status: int | str, error: str = "") -> dict:
    return {"passed": passed, "expected": expected, "status": status, "error": error}


async def run_attacks(api: FairDropApi, drop_id: str, users: list[dict]) -> dict:
    action_users = {user["action"]: user for user in users if user.get("action")}
    action_names = ("replay", "forged_redeem", "double_redeem", "late_payer", "payment_failer", "reconnect")
    offers = {}
    for name in action_names:
        user = action_users.get(name)
        if user:
            offers[name] = _offer(await _me(api, drop_id, user))

    results = {}
    replay_user = action_users["replay"]
    replay_target = next((
        offers.get(name) for name in ("double_redeem", "late_payer", "payment_failer", "reconnect")
        if offers.get(name)
    ), None)
    if replay_target:
        response = await _redeem(api, replay_target["offer_id"], replay_user["token"], str(uuid.uuid4()))
        body = api.payload(response)
        results["replay"] = _result(
            response.status_code == 403,
            "403 offer_not_yours",
            response.status_code,
            str(body.get("error", "")),
        )
    else:
        results["replay"] = _result(False, "403 offer_not_yours", "no offer to replay")

    forged_user = action_users["forged_redeem"]
    response = await _redeem(api, str(uuid.uuid4()), forged_user["token"], str(uuid.uuid4()))
    body = api.payload(response)
    results["forged_redeem"] = _result(
        response.status_code in (403, 409), "403 or 409; never 200", response.status_code,
        str(body.get("error", "")),
    )

    double_user = action_users["double_redeem"]
    double_offer = offers.get("double_redeem")
    if double_offer:
        responses = await asyncio.gather(*(
            _redeem(api, double_offer["offer_id"], double_user["token"], str(uuid.uuid4()))
            for _ in range(50)
        ))
        successes = sum(response.status_code == 200 for response in responses)
        results["double_redeem"] = _result(
            successes == 1, "exactly one 200 from 50 order IDs", successes,
        )
    else:
        results["double_redeem"] = _result(False, "exactly one 200", "no offer")

    late_user = action_users["late_payer"]
    late_offer = offers.get("late_payer")
    if late_offer and late_offer.get("expires_at"):
        expiry = datetime.fromisoformat(late_offer["expires_at"].replace("Z", "+00:00")).astimezone(timezone.utc)
        await asyncio.sleep(max(0, (expiry - datetime.now(timezone.utc)).total_seconds() - 1))
        order_id = str(uuid.uuid4())
        redeem = await _redeem(api, late_offer["offer_id"], late_user["token"], order_id)
        if redeem.status_code == 200:
            await asyncio.sleep(30)
            payment = await api.request(
                "POST", f"/api/offers/{late_offer['offer_id']}/pay", token=late_user["token"],
                body={"order_id": order_id, "result": "success"},
            )
            payment_body = api.payload(payment)
            status = payment_body.get("status", payment.status_code)
            results["late_payer"] = _result(
                payment.status_code == 200 and status == "confirmed",
                "confirmed after the offer deadline", status,
            )
        else:
            results["late_payer"] = _result(False, "redeem before expiry; then confirm", redeem.status_code)
    else:
        results["late_payer"] = _result(False, "offer has an expiry", "no offer")

    fail_user = action_users["payment_failer"]
    fail_offer = offers.get("payment_failer")
    if fail_offer:
        order_id = str(uuid.uuid4())
        redeem = await _redeem(api, fail_offer["offer_id"], fail_user["token"], order_id)
        if redeem.status_code == 200:
            payment = await api.request(
                "POST", f"/api/offers/{fail_offer['offer_id']}/pay", token=fail_user["token"],
                body={"order_id": order_id, "result": "fail"},
            )
            status = api.payload(payment).get("status")
            results["payment_failer"] = _result(
                payment.status_code == 200 and status == "payment_failed",
                "stock released after payment failure", status or payment.status_code,
            )
        else:
            results["payment_failer"] = _result(False, "payment failure releases stock", redeem.status_code)
    else:
        results["payment_failer"] = _result(False, "payment failure releases stock", "no offer")

    reconnect_user = action_users["reconnect"]
    first = await _me(api, drop_id, reconnect_user)
    login = await api.checked("POST", "/platform/login", body={"username": reconnect_user["username"], **reconnect_user["risk"]})
    fresh_user = {**reconnect_user, "token": bearer_token(login)}
    second = await _me(api, drop_id, fresh_user)
    stable = lambda value: {key: value.get(key) for key in ("phase", "entry", "offer")}
    same = json.dumps(stable(first), sort_keys=True) == json.dumps(stable(second), sort_keys=True)
    results["reconnect"] = _result(same, "same entry and offer after a fresh login", "same" if same else "changed")
    return results

