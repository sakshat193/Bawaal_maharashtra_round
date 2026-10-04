"""Live bot swarm for the demo: one laptop plays a scalper with hundreds or thousands of bots.

    python scripts/bot_swarm.py http://<demo-machine-ip>:8000 --bots 1000

Start it BEFORE the presenter clicks Reset on the demo panel: it waits for the new drop,
pre-solves proof-of-work on every CPU core, fires every entry the instant registration
opens, and after the draw makes every winning bot hammer the best seats and buy them.

What a real scalper looks like, and what this simulates:
  farm bots       most identities share a handful of devices and payment cards and are
                  freshly created accounts (--devices, --cards); real farms can't afford
                  one phone, one card and one aged account per bot.
  expensive bots  a small share (--expensive) that look like distinct real people:
                  own device, own card, old account. These pass the Sybil rules.

The server needs DEMO_MODE=true (compose default) so the mock identity platform takes the
bots' device/card/account age from the login request; a real platform knows them itself.
All bots come from one IP, so turn the per-IP rate limit off for the demo
(RATE_LIMIT_ENABLED=false) to stand in for a botter's rotating proxies; with it on,
most bots are simply refused with 429.

Honest reading of the scorecard: Fair Drop does not know who is human. It guarantees
that bots gain nothing from speed or volume: shared-resource bots are excluded by rules
published before anyone entered, and each surviving bot has exactly one person's odds
per ticket and chooses seats only when its draw rank says so.
"""
import argparse
import asyncio
import base64
import json
import os
import random
import sys
import time
import uuid
from collections import Counter
from concurrent.futures import ProcessPoolExecutor
from datetime import datetime, timezone
from pathlib import Path

import httpx

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "common"))
from fairdrop_common import pow as fpow  # noqa: E402

TURNSTILE_TEST_TOKEN = "XXXX.DUMMY.TOKEN.XXXX"


def now() -> float:
    return time.time()


def parse_ts(s: str) -> float:
    return datetime.fromisoformat(s.replace("Z", "+00:00")).timestamp()


def jwt_claims(token: str) -> dict:
    body = token.split(".")[1]
    return json.loads(base64.urlsafe_b64decode(body + "=" * (-len(body) % 4)))


def solve(challenge: str, bits: int, k: int, memory_kib: int) -> list[int]:
    return fpow.solve(challenge, bits, k, memory_kib)


class Swarm:
    def __init__(self, args):
        self.a = args
        self.run = uuid.uuid4().hex[:6]
        self.c = httpx.AsyncClient(base_url=args.base, timeout=60,
                                   limits=httpx.Limits(max_connections=args.concurrency))
        self.sem = asyncio.Semaphore(args.concurrency)
        self.stats = Counter()
        self.bots: list[dict] = []
        self.t0 = now()

    async def req(self, method: str, url: str, **kw) -> httpx.Response | None:
        """Like a real swarm: retry dropped connections; never let one failure stop the run.
        Every call retried here is idempotent (entries return the same receipt on retry)."""
        for attempt in range(5):
            try:
                async with self.sem:
                    return await self.c.request(method, url, **kw)
            except httpx.TransportError:
                self.stats["network_retries"] += 1
                await asyncio.sleep(0.2 * (attempt + 1))
        self.stats["network_failures"] += 1
        return None

    def log(self, msg: str) -> None:
        print(f"[{now() - self.t0:6.1f}s] {msg}", flush=True)

    async def find_drop(self) -> dict:
        if self.a.drop:
            return (await self.c.get(f"/api/drops/{self.a.drop}")).json()
        self.log("waiting for a new drop (click Reset on the demo panel)...")
        seen = {d["drop_id"] for d in (await self.c.get("/api/drops")).json()["drops"]} if not self.a.use_existing else set()
        while True:
            drops = (await self.c.get("/api/drops")).json()["drops"]
            fresh = [d for d in drops if d["phase"] in ("scheduled", "open") and d["drop_id"] not in seen]
            if fresh:
                return (await self.c.get(f"/api/drops/{fresh[-1]['drop_id']}")).json()
            await asyncio.sleep(0.3)

    def identity_knobs(self, i: int) -> dict:
        """Most bots come from the farm; a few are expensive look-alike real people."""
        if random.random() < self.a.expensive:
            return {"kind": "expensive", "knobs": {}}            # platform gives a unique device/card, aged account
        return {"kind": "farm", "knobs": {
            "device_hash": f"farm-device-{self.run}-{i % self.a.devices}",
            "payment_fingerprint": f"farm-card-{self.run}-{i % self.a.cards}",
            "account_age_days": random.randint(0, 3)}}

    async def login(self, i: int) -> dict:
        spec = self.identity_knobs(i)
        r = await self.req("POST", "/platform/login", json={"username": f"bot-{self.run}-{i}", **spec["knobs"]})
        if r is None or r.status_code != 200:
            self.stats[f"login_{getattr(r, 'status_code', 'error')}"] += 1
            return {}
        tok = r.json()["token"]
        bot = {"i": i, "kind": spec["kind"], "token": tok, "h": {"Authorization": f"Bearer {tok}"}}
        if spec["kind"] == "farm" and jwt_claims(tok).get("device_hash") != spec["knobs"]["device_hash"]:
            self.stats["knobs_ignored"] += 1
        return bot

    async def enter(self, bot: dict, drop: dict, pool, opens_at: float) -> None:
        did = drop["drop_id"]
        r = await self.req("GET", f"/api/drops/{did}/pow-challenge", headers=bot["h"])
        if r is None or r.status_code != 200:
            self.stats[f"challenge_{getattr(r, 'status_code', 'error')}"] += 1
            return
        ch = r.json()
        nonces = await asyncio.get_running_loop().run_in_executor(
            pool, solve, ch["challenge"], ch["bits"], ch["k"], ch["memory_kib"])
        self.stats["pow_solved"] += 1
        wait = opens_at - now()
        if wait > 0:                                              # speed bot: fire at the opening instant
            await asyncio.sleep(wait)
        body = {"tier_id": self.a.tier, "quantity": self.q, "turnstile_token": TURNSTILE_TEST_TOKEN,
                "pow": {"issued_at": ch["issued_at"], "nonces": nonces}}
        r = await self.req("POST", f"/api/drops/{did}/entries", headers=bot["h"], json=body)
        if r is None:
            self.stats["entry_rejected:network"] += 1
            return
        if r.status_code in (200, 201):
            bot["entry_id"] = r.json()["entry_id"]
            self.stats["entered"] += 1
        else:
            code = r.json().get("error", r.status_code) if r.headers.get("content-type", "").startswith("application/json") else r.status_code
            self.stats[f"entry_rejected:{code}"] += 1

    async def progress(self, total: int, until: asyncio.Event) -> None:
        last = 0
        while not until.is_set():
            s = self.stats
            rate = (s["pow_solved"] - last)
            last = s["pow_solved"]
            rej = sum(v for k, v in s.items() if k.startswith("entry_rejected"))
            self.log(f"PoW solved {s['pow_solved']}/{total} ({rate}/s) | entries accepted {s['entered']} | rejected {rej}")
            try:
                await asyncio.wait_for(until.wait(), 1.0)
            except asyncio.TimeoutError:
                pass

    async def wait_phase(self, did: str, phases: set[str], need_timestamp: bool = False) -> dict:
        while True:
            d = (await self.c.get(f"/api/drops/{did}")).json()
            if d["phase"] in phases and (not need_timestamp or (d.get("snapshot") or {}).get("timestamped_at")):
                return d
            await asyncio.sleep(1)

    async def attack_seats(self, bot: dict, drop: dict, offer: dict) -> None:
        """Grab the best (front-most) seats as fast as possible, then buy."""
        oid, did = offer["offer_id"], drop["drop_id"]
        deadline = parse_ts(offer["expires_at"])
        first_try = None
        while now() < deadline:
            sm = await self.req("GET", f"/api/drops/{did}/seats")
            if sm is None:
                continue
            seat_map = sm.json()
            tier = next(t for t in seat_map["tiers"] if t["tier_id"] == offer["tier_id"])
            taken = set(tier["locked"]) | set(tier["booked"])
            best = [s for s in range(tier["capacity"]) if s not in taken][:offer["quantity"]]
            r = await self.req("PUT", f"/api/offers/{oid}/seats", headers=bot["h"], json={"seats": best})
            first_try = first_try or now()
            if r is None:
                continue
            if r.status_code == 200:
                bot["seats"] = best
                bot["seat_wait_s"] = now() - first_try
                break
            err = r.json().get("error")
            self.stats[f"seat_refused:{err}"] += 1
            await asyncio.sleep(0.25 if err == "seat_window_not_open" else 0.05)
        else:
            return
        order = str(uuid.uuid4())
        r = await self.req("POST", f"/api/offers/{oid}/redeem", headers=bot["h"], json={"order_id": order})
        if r is not None and r.status_code == 200:
            r = await self.req("POST", f"/api/offers/{oid}/pay", headers=bot["h"], json={"order_id": order, "result": "success"})
            if r is not None and r.status_code == 200 and r.json().get("status") == "confirmed":
                self.stats["bot_tickets_bought"] += offer["quantity"]

    async def main(self) -> dict:
        drop = await self.find_drop()
        did = drop["drop_id"]
        self.q = min(self.a.quantity, drop["max_quantity"])
        opens_at, closes_at = parse_ts(drop["opens_at"]), parse_ts(drop["closes_at"])
        self.log(f"target: {drop['name']} ({did}) | window {drop['opens_at']} -> {drop['closes_at']} | "
                 f"PoW {drop['pow_bits']} bits x {drop['pow_k']} | seat selection {drop.get('seat_selection')}")

        self.log(f"creating {self.a.bots} bot identities...")
        self.bots = [b for b in await asyncio.gather(*(self.login(i) for i in range(self.a.bots))) if b]
        kinds = Counter(b["kind"] for b in self.bots)
        self.log(f"identities: {len(self.bots)} ({kinds['farm']} farm, {kinds['expensive']} expensive)")
        if self.stats["knobs_ignored"]:
            self.log("WARNING: the server ignores device/card knobs (DEMO_MODE off): every bot looks like a distinct person")

        done = asyncio.Event()
        ticker = asyncio.create_task(self.progress(len(self.bots), done))
        with ProcessPoolExecutor(max_workers=self.a.workers) as pool:
            await asyncio.gather(*(self.enter(b, drop, pool, opens_at) for b in self.bots))
        done.set()
        await ticker
        if self.stats.get("entry_rejected:rate_limited"):
            self.log("NOTE: rate-limited - all bots share this laptop's IP. For the demo run the API with RATE_LIMIT_ENABLED=false.")
        late = self.stats.get("entry_rejected:window_closed", 0)
        self.log(f"registration: {self.stats['entered']} bot entries accepted, {late} too late (PoW not finished before close)")

        self.log("waiting for the seal...")
        d = await self.wait_phase(did, {"sealed", "drawn", "settled"}, need_timestamp=True)
        excl = (await self.c.get(f"/api/drops/{did}/exclusions")).content.decode().splitlines()
        reasons = {json.loads(line)["entry_id"]: json.loads(line)["reason"] for line in excl}
        bot_entries = {b["entry_id"]: b for b in self.bots if "entry_id" in b}
        bot_excluded = Counter(reasons[e] for e in bot_entries if e in reasons)
        bot_eligible = [b for e, b in bot_entries.items() if e not in reasons]
        humans_entered = d["counts"]["entries"] - len(bot_entries)
        self.log(f"SEAL: {sum(bot_excluded.values())} of {len(bot_entries)} bot entries excluded "
                 f"({', '.join(f'{k} {v}' for k, v in bot_excluded.most_common())}); "
                 f"{len(bot_eligible)} bots still in the draw next to {humans_entered} other entries")

        self.log(f"waiting for the draw (public drand round due {d['drand_round_due_at']})...")
        d = await self.wait_phase(did, {"drawn", "settled"})
        draw = (await self.c.get(f"/api/drops/{did}/draw")).json()
        ranks = {e: i + 1 for i, e in enumerate(draw["ranked_entry_ids"])}
        winners = {a["entry_id"] for a in draw["allocation"]}
        bot_winners = [b for b in bot_eligible if b["entry_id"] in winners]
        human_winners = len(winners - set(bot_entries))
        ahead = next((i for i, e in enumerate(draw["ranked_entry_ids"]) if e in bot_entries), len(draw["ranked_entry_ids"]))
        self.log(f"DRAW: {len(winners)} offers | {len(bot_winners)} to bots | {human_winners} to everyone else")

        offers = []
        for b in bot_winners:
            me = (await self.c.get(f"/api/drops/{did}/me", headers=b["h"])).json()
            if me.get("offer"):
                offers.append((b, me["offer"]))
        if offers and d.get("seat_selection"):
            self.log(f"{len(offers)} winning bots now hammer the best seats...")
            await asyncio.gather(*(self.attack_seats(b, d, o) for b, o in offers))
        elif offers:
            for b, o in offers:
                order = str(uuid.uuid4())
                await self.c.post(f"/api/offers/{o['offer_id']}/redeem", headers=b["h"], json={"order_id": order})
                r = await self.c.post(f"/api/offers/{o['offer_id']}/pay", headers=b["h"], json={"order_id": order, "result": "success"})
                if r.status_code == 200:
                    self.stats["bot_tickets_bought"] += o["quantity"]

        refused = {k.split(":", 1)[1]: v for k, v in self.stats.items() if k.startswith("seat_refused:")}
        report = {
            "drop_id": did, "bots_launched": self.a.bots, "identities": dict(kinds),
            "pow_solved": self.stats["pow_solved"], "bot_entries_accepted": len(bot_entries),
            "entry_rejections": {k.split(":", 1)[1]: v for k, v in self.stats.items() if k.startswith("entry_rejected:")},
            "bot_entries_excluded_at_seal": dict(bot_excluded), "bot_entries_in_draw": len(bot_eligible),
            "other_entries": humans_entered, "offers_total": len(winners), "offers_to_bots": len(bot_winners),
            "offers_to_others": human_winners,
            "best_bot_rank": min((ranks[b["entry_id"]] for b in bot_eligible), default=None),
            "other_entries_ranked_ahead_of_every_bot": ahead,
            "seat_attempts_refused": refused, "bot_tickets_bought": self.stats["bot_tickets_bought"],
        }
        print("\n================  BOT SWARM SCORECARD  ================")
        print(f" bots launched                {self.a.bots}  ({kinds['farm']} farm, {kinds['expensive']} expensive)")
        print(f" proof-of-work solved         {self.stats['pow_solved']}")
        print(f" entries accepted             {len(bot_entries)}")
        print(f" excluded at the seal         {sum(bot_excluded.values())}   " + ", ".join(f"{k}: {v}" for k, v in bot_excluded.most_common()))
        print(f" bots left in the draw        {len(bot_eligible)}   (each with one person's odds per ticket)")
        print(f" offers: bots / everyone else {len(bot_winners)} / {human_winners}")
        print(f" real entries ranked ahead    {ahead} of {humans_entered} before the first bot (they choose seats first)")
        if refused:
            print(f" seat grabs refused           " + ", ".join(f"{k}: {v}" for k, v in refused.items()))
        print(f" tickets the bots bought      {self.stats['bot_tickets_bought']}")
        print("========================================================")
        await self.c.aclose()
        return report


def main() -> None:
    if hasattr(sys.stdout, "reconfigure"):          # Windows consoles default to cp1252
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("base", help="API base URL, e.g. http://192.168.1.20:8000")
    ap.add_argument("--bots", type=int, default=1000)
    ap.add_argument("--expensive", type=float, default=0.02, help="share of bots that look like distinct real people")
    ap.add_argument("--devices", type=int, default=12, help="farm devices shared by the farm bots")
    ap.add_argument("--cards", type=int, default=6, help="payment cards shared by the farm bots")
    ap.add_argument("--tier", default="gold")
    ap.add_argument("--quantity", type=int, default=4, help="scalpers ask for the maximum")
    ap.add_argument("--workers", type=int, default=os.cpu_count() or 4, help="CPU processes for proof-of-work")
    ap.add_argument("--concurrency", type=int, default=200)
    ap.add_argument("--drop", help="attack this drop id instead of waiting for a new one")
    ap.add_argument("--use-existing", action="store_true", help="attack the newest open/scheduled drop right away")
    ap.add_argument("--report", default="bot_swarm_report.json")
    a = ap.parse_args()
    report = asyncio.run(Swarm(a).main())
    Path(a.report).write_text(json.dumps(report, indent=2))
    print(f"report written to {a.report}")


if __name__ == "__main__":
    main()
