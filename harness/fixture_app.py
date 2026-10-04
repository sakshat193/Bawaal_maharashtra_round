"""Serve operationId response fixtures for local UI and client development."""

from __future__ import annotations

import json
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse


FIXTURES = Path(__file__).resolve().parents[1] / "contracts" / "fixtures"
ERROR_STATUS = {
    "invalid_request": 400,
    "unknown_tier": 400,
    "quantity_exceeds_max": 400,
    "turnstile_failed": 400,
    "unauthorized": 401,
    "offer_not_yours": 403,
    "window_closed": 403,
    "payment_window_closed": 409,
    "offer_expired": 409,
    "already_redeemed_other_order": 409,
    "not_offered": 409,
    "not_payment_pending": 409,
    "entry_exists_different_terms": 409,
}

app = FastAPI(title="Fair Drop fixture server")


def _operation(method: str, path: str) -> str | None:
    parts = [part for part in path.strip("/").split("/") if part]
    method = method.upper()
    if parts == ["api", "drops"] and method == "GET":
        return "listDrops"
    if parts == ["platform", "login"] and method == "POST":
        return "login"
    if parts == ["api", "keys"] and method == "GET":
        return "getKeys"
    if len(parts) == 3 and parts[:2] == ["api", "drops"] and method == "GET":
        return "getDrop"
    if len(parts) == 4 and parts[:2] == ["api", "drops"]:
        suffix = parts[3]
        if (suffix, method) in {("pow-challenge", "GET"), ("entries", "POST"), ("snapshot", "GET"), ("exclusions", "GET"), ("me", "GET"), ("draw", "GET"), ("invariants", "GET")}:
            return {
                "pow-challenge": "getPowChallenge", "entries": "createEntry",
                "snapshot": "getSnapshot", "exclusions": "getExclusions",
                "me": "getMe", "draw": "getDraw", "invariants": "getInvariants",
            }[suffix]
    if len(parts) == 4 and parts[:2] == ["api", "offers"] and parts[3] in {"redeem", "pay", "decline"} and method == "POST":
        return {"redeem": "redeemOffer", "pay": "payOffer", "decline": "declineOffer"}[parts[3]]
    if parts == ["api", "admin", "drops"] and method == "POST":
        return "adminCreateDrop"
    if parts == ["api", "admin", "reset"] and method == "POST":
        return "adminReset"
    if len(parts) == 5 and parts[:3] == ["api", "admin", "drops"]:
        return {"open": "adminOpen", "seal": "adminSeal", "draw": "adminDraw", "outcomes": "adminOutcomes"}.get(parts[4])
    return None


@app.api_route("/{path:path}", methods=["GET", "POST", "PUT", "PATCH", "DELETE"])
async def serve_fixture(path: str, request: Request):
    operation = _operation(request.method, "/" + path)
    if operation is None:
        return JSONResponse({"error": "not_found", "message": "No fixture operation matches this route."}, status_code=404)
    variant = request.query_params.get("scenario")
    status = ERROR_STATUS.get(variant, 200)
    candidates = []
    if variant:
        candidates.append(FIXTURES / f"{operation}.{status}.{variant}.json")
    if status == 200:
        candidates.append(FIXTURES / f"{operation}.200.json")
    fixture_path = next((candidate for candidate in candidates if candidate.is_file()), None)
    if fixture_path is None:
        return JSONResponse({
            "error": "fixture_missing",
            "message": f"Add {operation}.{status}[.{variant}].json under contracts/fixtures.",
        }, status_code=404)
    try:
        value = json.loads(fixture_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return JSONResponse({"error": "fixture_invalid", "message": f"Invalid JSON fixture: {fixture_path.name}"}, status_code=500)
    return JSONResponse(value, status_code=status)

