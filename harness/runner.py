"""Drive the same synthetic population through three allocation modes."""

from __future__ import annotations

import asyncio
import base64
import hashlib
import json
import math
import os
import uuid
from concurrent.futures import ProcessPoolExecutor
from datetime import datetime, timedelta, timezone
from pathlib import Path

from fairdrop_common import canonical, pow, sybil

from .api import FairDropApi, bearer_token
from .attacks import run_attacks
from .profiles import load_users

GENESIS = 1692803367
PERIOD = 3
CHAIN = "52db9ba70e0cc0f6eaf7803dd07447a1f5477735fd3f661792ba94600c84e971"
MODES = ("naive_fcfs", "hardened_fcfs", "lottery_wil")
ACTIVE = {"offered", "payment_pending", "confirmed"}


def _iso(value: datetime) -> str:
    return value.astimezone(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def _round_at(timestamp: datetime) -> int:
    seconds = timestamp.timestamp()
    return max(1, math.ceil((seconds - GENESIS) / PERIOD) + 1)


def _jwt_identity(token: str):
    try:
        segment = token.split(".")[1]
        segment += "=" * (-len(segment) % 4)
        claims = json.loads(base64.urlsafe_b64decode(segment))
        return claims.get("identity_id") or claims.get("sub")
    except (IndexError, ValueError, json.JSONDecodeError):
        return None


def _solve_pow(parameters: dict) -> list[int]:
    return pow.solve(parameters["challenge"], parameters["bits"], parameters["k"], parameters["memory_kib"])


def _drop_body(mode: str, drop_id: str, close_at: datetime, pow_bits: int) -> dict:
    hardened = mode != "naive_fcfs"
    return {
        "drop_id": drop_id,
        "name": f"Fair Drop harness · {mode}",
        "venue": "Harness venue",
        "starts_at": _iso(close_at + timedelta(days=1)),
        "opens_at": _iso(datetime.now(timezone.utc) - timedelta(seconds=1)),
        "closes_at": _iso(close_at),
        "allocation_mode": "lottery_wil" if mode == "lottery_wil" else "fcfs",
        "pow_required": hardened,
        "turnstile_required": False,
        "pow_bits": pow_bits,
        "pow_k": 16,
        "pow_memory_kib": 2048,
        "max_quantity": 4,
        "offer_ttl_s": 45,
        "pay_deadline_s": 60,
        "max_promotion_rounds": 3,
        "sybil_rules": [
            {"id": "device", "kind": "max_per_device", "limit": 2},
            {"id": "payment", "kind": "max_per_payment", "limit": 2},
        ] if hardened else [],
        "drand_chain": CHAIN,
        "tiers": [
            {"tier_id": "main", "name": "Main", "price_paise": 10000, "capacity": 40},
            {"tier_id": "payment_tests", "name": "Payment tests", "price_paise": 10000, "capacity": 20},
        ],
    }


async def _login(api: FairDropApi, user: dict) -> dict:
    data = await api.checked("POST", "/platform/login", body={"username": user["username"], **user["risk"]})
    token = bearer_token(data)
    identity = data.get("identity") if isinstance(data.get("identity"), dict) else {}
    return {**user, "token": token, "identity_id": data.get("identity_id") or identity.get("identity_id") or _jwt_identity(token)}


async def _register(api: FairDropApi, drop: dict, user: dict, pool: ProcessPoolExecutor, semaphore: asyncio.Semaphore):
    async with semaphore:
        pow_proof = None
        if drop["pow_required"]:
            challenge = await api.checked(
                "GET", f"/api/drops/{drop['drop_id']}/pow-challenge", token=user["token"]
            )
            loop = asyncio.get_running_loop()
            nonces = await loop.run_in_executor(pool, _solve_pow, challenge)
            pow_proof = {"issued_at": challenge["issued_at"], "nonces": nonces}
        body = {
            "tier_id": user["tier_id"],
            "quantity": user["quantity"],
            "turnstile_token": "harness-turnstile-disabled",
        }
        if pow_proof is not None:
            body["pow"] = pow_proof
        response = await api.request(
            "POST", f"/api/drops/{drop['drop_id']}/entries", token=user["token"], body=body
        )
        if response.is_error:
            data = api.payload(response)
            raise RuntimeError(f"entry {user['username']} failed: {response.status_code} {data}")
        result = api.payload(response)
        return {**user, "entry_id": result.get("entry_id"), "entry_response": result}


async def _create_mode(api: FairDropApi, mode: str, close_at: datetime, pow_bits: int) -> dict:
    drop_id = str(uuid.uuid4())
    body = _drop_body(mode, drop_id, close_at, pow_bits)
    created = await api.checked("POST", "/api/admin/drops", admin=True, body=body)
    actual_id = created.get("drop_id", created.get("id", drop_id))
    await api.checked("POST", f"/api/admin/drops/{actual_id}/open", admin=True, body={})
    return {**body, **created, "drop_id": actual_id, "mode": mode}


def _invariant_summary(value: dict) -> dict:
    tiers = value.get("tiers", value.get("by_tier", []))
    if isinstance(tiers, dict):
        tiers = [dict(data, tier_id=tier_id) for tier_id, data in tiers.items() if isinstance(data, dict)]
    has_tiers = isinstance(tiers, list) and bool(tiers)
    held_ok = has_tiers
    held_matches_active = has_tiers
    oversell = 0
    for tier in tiers if isinstance(tiers, list) else []:
        held, capacity = int(tier.get("held", 0)), int(tier.get("capacity", 0))
        held_ok = held_ok and held <= capacity
        oversell += max(0, held - capacity)
        active = next((tier[key] for key in (
            "active_offer_quantity", "active_offer_units", "active_offers_quantity", "active_units", "active_offers"
        ) if key in tier), None)
        if isinstance(active, bool) or not isinstance(active, (int, float)):
            held_matches_active = False
        else:
            held_matches_active = held_matches_active and int(active) == held
    double_redemption = next((value[key] for key in (
        "double_redemption", "double_redemptions", "double_redeem_count", "entries_with_multiple_offers", "multiple_offers"
    ) if key in value), None)
    if isinstance(double_redemption, bool) or not isinstance(double_redemption, int) or double_redemption < 0:
        raise RuntimeError("invariants must include a non-negative double_redemption counter")
    return {
        "held_within_capacity": held_ok,
        "held_matches_active_offers": held_matches_active,
        "oversell": int(value.get("oversell", value.get("oversell_count", oversell))),
        "double_redemption": double_redemption,
        "raw": value,
    }


async def _published_exclusions(api: FairDropApi, drop: dict, users: list[dict]) -> list[dict]:
    response = await api.request('GET', f"/api/drops/{drop['drop_id']}/exclusions")
    if response.status_code != 200:
        raise RuntimeError(f'exclusions returned {response.status_code}')
    blob = response.content
    if hashlib.sha256(blob).hexdigest() != response.headers.get('X-Fairdrop-Exclusions-Sha256'):
        raise RuntimeError('published exclusions hash does not match bytes')
    rows = [json.loads(line) for line in blob.splitlines()]
    if canonical.exclusions_bytes(rows) != blob:
        raise RuntimeError('published exclusions are not canonical')
    facts = [{'entry_id': user['entry_id'], **user['risk']} for user in users]
    expected = sybil.apply(drop['sybil_rules'], facts)
    if [(row['entry_id'], row['reason']) for row in rows] != expected:
        raise RuntimeError('published exclusions do not match frozen Sybil rules')
    return rows


def _summarize(mode: str, users: list[dict], outcomes: list[dict], invariants: dict, attacks: dict,
               exclusion_rows: list[dict]) -> dict:
    profile_users = {}
    for user in users:
        profile_users.setdefault(user["profile"], []).append(user)
    by_identity = {user["identity_id"]: user for user in users if user.get("identity_id")}
    by_entry = {user["entry_id"]: user for user in users if user.get("entry_id")}
    counts = {
        name: {"identities": len({user.get("identity_id") or user["username"] for user in group}),
               "entries": 0, "tickets_won": 0, "bot": group[0]["bot"], "cohort": group[0]["cohort"]}
        for name, group in profile_users.items()
    }
    exclusions = {}
    for row in exclusion_rows:
        reason = row['reason']
        exclusions[reason] = exclusions.get(reason, 0) + 1
    won = bot_won = total_won = groups_won = singles_won = 0
    bot_ids = set()
    all_ids = set()
    for user in users:
        identity = user.get("identity_id") or user["username"]
        all_ids.add(identity)
        if user["bot"]:
            bot_ids.add(identity)
        counts[user["profile"]]["entries"] += 1
    for outcome in outcomes:
        user = by_entry.get(outcome.get("entry_id")) or by_identity.get(outcome.get("identity_id"))
        if not user:
            continue
        if outcome.get("status") in ACTIVE:
            quantity = int(outcome.get("quantity", user["quantity"]))
            counts[user["profile"]]["tickets_won"] += quantity
            total_won += quantity
            won += quantity
            if user["bot"]:
                bot_won += quantity
            if user["cohort"] == "groups":
                groups_won += 1
            if user["cohort"] == "singles":
                singles_won += 1
    bots = sum(user["bot"] for user in users)
    return {
        "mode": mode,
        "entries": len(users),
        "identities": len(all_ids),
        "tickets_won": total_won,
        "profiles": counts,
        "bot_ticket_share": round(bot_won / total_won, 5) if total_won else 0,
        "bot_identity_share": round(len(bot_ids) / len(all_ids), 5) if all_ids else 0,
        "bot_share_ratio": round((bot_won / total_won) / (len(bot_ids) / len(all_ids)), 3) if total_won and bot_ids else 0,
        "groups_vs_singles": {
            "group_members": groups_won,
            "singles": singles_won,
            "ratio": round(groups_won / singles_won, 4) if singles_won else None,
        },
        "exclusions_per_rule": exclusions,
        "invariants": {key: value for key, value in invariants.items() if key != "raw"},
        "attack_checks": attacks,
        "configured_bot_identities": bots,
    }


async def _finish_mode(api: FairDropApi, drop: dict) -> dict:
    due = GENESIS + (drop["drand_round"] - 1) * PERIOD
    wait = due + 1 - datetime.now(timezone.utc).timestamp()
    if wait > 0:
        print(f"Waiting {int(wait)}s for {drop['mode']} committed round {drop['drand_round']}.")
        await asyncio.sleep(wait)
    await api.checked("POST", f"/api/admin/drops/{drop['drop_id']}/draw", admin=True, body={})
    attack_checks = await run_attacks(api, drop['drop_id'], drop['users'])
    users_for_drop = drop["users"]
    outcomes_value = await api.checked(
        "GET", f"/api/admin/drops/{drop['drop_id']}/outcomes", admin=True
    )
    outcomes = outcomes_value.get("outcomes", outcomes_value.get("entries", outcomes_value.get("data", [])))
    if not isinstance(outcomes, list):
        raise RuntimeError("admin outcomes response must contain an outcomes list")
    invariants_value = await api.checked(
        "GET", f"/api/drops/{drop['drop_id']}/invariants"
    )
    exclusion_rows = await _published_exclusions(api, drop, users_for_drop)
    return _summarize(
        drop["mode"], users_for_drop, outcomes,
        _invariant_summary(invariants_value), attack_checks, exclusion_rows,
    )


async def run_harness(base_url: str, profiles_path: Path, out_path: Path, workers: int = 4, concurrency: int = 32, pow_bits: int = 4) -> dict:
    admin_key = os.environ.get("ADMIN_KEY")
    if not admin_key:
        raise ValueError("set ADMIN_KEY in the environment before running the live harness")
    profiles, templates = load_users(profiles_path)
    api = FairDropApi(base_url, admin_key)
    finishes = []
    try:
        login_limit = asyncio.Semaphore(32)
        async def login_limited(user):
            async with login_limit:
                return await _login(api, user)
        users = await asyncio.gather(*(login_limited(user) for user in templates))
        # A mode's entry window starts when its population gets the workers.
        # Finish each mode at its own round so early offers cannot expire waiting for later modes.
        with ProcessPoolExecutor(max_workers=workers) as pool:
            for mode in MODES:
                close_at = datetime.now(timezone.utc).replace(microsecond=0) + timedelta(seconds=180)
                drop = await _create_mode(api, mode, close_at, pow_bits)
                drop["drand_round"] = int(drop.get("drand_round") or _round_at(close_at + timedelta(minutes=2)))
                semaphore = asyncio.Semaphore(concurrency)
                drop["users"] = list(await asyncio.gather(*(
                    _register(api, drop, user, pool, semaphore)
                    for user in sorted(users, key=lambda item: (item["arrival"] != "first", item["profile"], item["profile_index"]))
                )))
                await api.checked("POST", f"/api/admin/drops/{drop['drop_id']}/seal", admin=True, body={})
                finishes.append(asyncio.create_task(_finish_mode(api, drop)))
        mode_results = await asyncio.gather(*finishes)
        result = {"schema_version": 1, "source": "live_harness", "modes": mode_results}
        out_path.parent.mkdir(parents=True, exist_ok=True)
        out_path.write_text(json.dumps(result, indent=2, ensure_ascii=True) + "\n", encoding="utf-8")
        return result
    finally:
        for task in finishes:
            if not task.done():
                task.cancel()
        await asyncio.gather(*finishes, return_exceptions=True)
        await api.close()

