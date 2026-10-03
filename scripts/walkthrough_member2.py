"""Guided walkthrough of everything Member 2 built, against a running API.

  docker compose up -d --build
  .venv/Scripts/python scripts/walkthrough_member2.py            # add --pause to go step by step

Every step prints what it is doing, what the server answered, and a CHECK line that
fails loudly if the behaviour is wrong. Needs the API in DEMO_MODE (compose default).
"""
import argparse
import base64
import hashlib
import json
import sys
import time
from datetime import datetime, timedelta, timezone

import httpx
import jwt

from fairdrop_common import crypto
from fairdrop_common import pow as fpow

ok_count = 0


def step(title: str, pause: bool) -> None:
    if pause:
        input(f"\n[Enter] {title} ")
    print(f"\n=== {title} " + "=" * max(0, 70 - len(title)))


def check(cond: bool, what: str) -> None:
    global ok_count
    if not cond:
        print(f"  FAIL  {what}")
        sys.exit(1)
    ok_count += 1
    print(f"  ok    {what}")


def iso(d: datetime) -> str:
    return d.strftime("%Y-%m-%dT%H:%M:%SZ")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default="http://localhost:8000")
    ap.add_argument("--admin-key", default="dev-admin-key-change-me")
    ap.add_argument("--pause", action="store_true", help="wait for Enter before each step")
    a = ap.parse_args()
    c = httpx.Client(base_url=a.base, timeout=60)
    A = {"X-Admin-Key": a.admin_key}

    step("1. Receipt public key (GET /api/keys)", a.pause)
    pub = c.get("/api/keys").json()["receipt"]
    print("  ", pub)

    step("2. Create a drop (POST /api/admin/drops)", a.pause)
    now = datetime.now(timezone.utc).replace(microsecond=0)
    body = {
        "name": "Walkthrough Live", "venue": "Test Arena", "starts_at": iso(now + timedelta(days=7)),
        "opens_at": iso(now + timedelta(hours=1)), "closes_at": iso(now + timedelta(hours=2)),
        "allocation_mode": "lottery_wil", "pow_required": True, "turnstile_required": True,
        "pow_bits": 4, "pow_k": 16, "pow_memory_kib": 2048, "max_quantity": 4,
        "sybil_rules": [{"id": "device", "kind": "max_per_device", "limit": 2},
                        {"id": "fresh", "kind": "min_account_age_s", "value": 86400}],
        "tiers": [{"tier_id": "gold", "name": "Gold", "price_paise": 450000, "capacity": 100}],
    }
    check(c.post("/api/admin/drops", json=body).status_code == 401, "admin route without X-Admin-Key -> 401")
    bad = {**body, "sybil_rules": [{"id": "x", "kind": "max_per_subnet", "limit": 1}]}
    check(c.post("/api/admin/drops", headers=A, json=bad).status_code == 422, "unknown Sybil rule kind -> 422")
    d = c.post("/api/admin/drops", headers=A, json=body).json()
    did = d["drop_id"]
    print(f"   drop_id {did}\n   config_hash {d['config_hash']}\n   drand round {d['drand_round']} "
          f"due {d['drand_round_due_at']} (closes {d['closes_at']})")
    check(d["phase"] == "scheduled", "new drop starts 'scheduled'")

    step("3. Entering before the window opens", a.pause)
    alice = {"Authorization": "Bearer " + c.post("/platform/login", json={"username": "alice"}).json()["token"]}
    r = c.post(f"/api/drops/{did}/entries", headers=alice, json={"tier_id": "gold", "quantity": 1})
    check(r.status_code == 400 and r.json()["error"] == "turnstile_failed",
          "no Turnstile token -> 400 turnstile_failed (checked first, outside any transaction)")
    r = c.post(f"/api/drops/{did}/entries", headers=alice,
               json={"tier_id": "gold", "quantity": 1, "turnstile_token": "XXXX.DUMMY.TOKEN.XXXX"})
    check(r.status_code == 403 and r.json()["error"] == "window_closed", "entry before opening -> 403 window_closed")
    check(c.post(f"/api/admin/drops/{did}/open", headers=A).status_code == 200, "admin opens the drop now")

    step("4. Mock platform login (POST /platform/login)", a.pause)
    lr = c.post("/platform/login", json={"username": "alice"}).json()
    claims = jwt.decode(lr["token"], options={"verify_signature": False})
    print("   JWT header:", jwt.get_unverified_header(lr["token"]))
    print("   JWT claims:", json.dumps(claims, indent=None))
    check(claims["identity_id"] == lr["identity_id"] and claims["exp"] - claims["iat"] <= 900,
          "EdDSA token, stable identity_id, lifetime <= 15 min")
    check(c.get(f"/api/drops/{did}/pow-challenge").status_code == 401, "private route without a JWT -> 401")
    forged = jwt.encode({**claims, "identity_id": "id_x", "sub": "id_x"}, "secret", algorithm="HS256")
    check(c.get(f"/api/drops/{did}/pow-challenge", headers={"Authorization": f"Bearer {forged}"}).status_code == 401,
          "forged HS256 token -> 401")

    def enter(username, qty=1, tier="gold", **knobs):
        h = {"Authorization": "Bearer " + c.post("/platform/login", json={"username": username, **knobs}).json()["token"]}
        ch = c.get(f"/api/drops/{did}/pow-challenge", headers=h).json()
        t = time.time()
        nonces = fpow.solve(ch["challenge"], ch["bits"], ch["k"], ch["memory_kib"])
        solve_s = time.time() - t
        payload = {"tier_id": tier, "quantity": qty, "turnstile_token": "XXXX.DUMMY.TOKEN.XXXX",
                   "pow": {"issued_at": ch["issued_at"], "nonces": nonces}}
        return h, ch, payload, c.post(f"/api/drops/{did}/entries", headers=h, json=payload), solve_s

    step("5. Proof-of-work + entry + signed receipt", a.pause)
    h, ch, payload, r, solve_s = enter("alice", qty=2)
    print(f"   challenge {ch['challenge'][:16]}... bits={ch['bits']} k={ch['k']} memory={ch['memory_kib']} KiB; "
          f"solved in {solve_s:.2f}s")
    print("   response:", json.dumps(r.json(), indent=None)[:300])
    check(r.status_code == 201, "entry accepted -> 201")
    check(crypto.verify_receipt(pub["public_key"], r.json()["receipt"], r.json()["receipt_sig"]),
          "receipt signature verifies against /api/keys")

    step("6. Retries, different terms, bad input", a.pause)
    r2 = c.post(f"/api/drops/{did}/entries", headers=h, json=payload)
    check(r2.status_code == 200 and r2.json() == r.json(), "identical retry -> 200 with the same receipt")
    r3 = c.post(f"/api/drops/{did}/entries", headers=h, json={**payload, "quantity": 3})
    check(r3.status_code == 409 and r3.json()["error"] == "entry_exists_different_terms", "changed quantity -> 409")
    _, _, _, r4, _ = enter("bob", tier="platinum")
    check(r4.json().get("error") == "unknown_tier", "unknown tier -> 400 unknown_tier")
    _, _, _, r5, _ = enter("bob", qty=5)
    check(r5.json().get("error") == "quantity_exceeds_max", "quantity 5 > max 4 -> 400 quantity_exceeds_max")

    step("7. More entrants: honest fans, a family, a bot farm, a brand-new account", a.pause)
    for u in ("bob", "chen", "divya"):
        check(enter(u)[3].status_code == 201, f"{u} entered")
    for u in ("mum", "dad"):
        check(enter(u, device_hash="family-ipad")[3].status_code == 201, f"{u} entered (shares the family iPad)")
    for i in range(4):
        check(enter(f"bot{i}", device_hash="farm-device-7")[3].status_code == 201, f"bot{i} entered (device farm)")
    check(enter("newbie", account_age_days=0)[3].status_code == 201, "newbie entered (account made today)")
    print("   counts:", c.get(f"/api/drops/{did}").json()["counts"])

    step("8. Seal: close, verify PoW, Sybil rules, publish, timestamp (POST .../seal)", a.pause)
    t = time.time()
    s = c.post(f"/api/admin/drops/{did}/seal", headers=A)
    print(f"   ({time.time() - t:.1f}s)", s.json())
    check(s.status_code == 200, "seal succeeded with a third-party timestamp before round R")
    late = c.post(f"/api/drops/{did}/entries", headers=h, json=payload)
    check(late.status_code == 403, "entry after the seal -> 403 window_closed")

    step("9. Public evidence: snapshot + exclusions, recomputed locally", a.pause)
    snap = c.get(f"/api/drops/{did}/snapshot")
    excl = c.get(f"/api/drops/{did}/exclusions")
    print("   snapshot (first 3 lines):")
    for line in snap.text.splitlines()[:3]:
        print("     ", line)
    print("   exclusions:")
    for line in excl.text.splitlines():
        print("     ", line)
    check(hashlib.sha256(snap.content).hexdigest() == s.json()["canonical_hash"], "sha256(snapshot bytes) matches")
    check(json.loads(snap.text.splitlines()[0])["exclusions_hash"] == hashlib.sha256(excl.content).hexdigest(),
          "snapshot header commits to the exclusions hash")
    reasons = {json.loads(l)["reason"] for l in excl.text.splitlines()}
    check(reasons == {"sybil:device", "sybil:fresh"}, "bot farm -> sybil:device, newbie -> sybil:fresh, family kept")
    proof = json.loads(base64.b64decode(snap.headers["x-fairdrop-timestamp-proof"]))
    cals = [x["calendar"] for x in proof.get("ots", {}).get("calendars", [])]
    print("   timestamped_at", snap.headers["x-fairdrop-timestamped-at"], "by", cals or list(proof))
    check(proof["snapshot_sha256"] == s.json()["canonical_hash"], "timestamp proof is for this snapshot hash")

    print(f"\nAll {ok_count} checks passed.\nTry in a browser:\n  {a.base}/docs\n  {a.base}/api/drops/{did}"
          f"\n  {a.base}/api/drops/{did}/snapshot\n  {a.base}/api/drops/{did}/exclusions")


if __name__ == "__main__":
    main()
