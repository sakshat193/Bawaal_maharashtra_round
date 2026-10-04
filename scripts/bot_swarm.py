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

Cheater bots (--cheaters) skip the proof-of-work and send made-up answers so they can
enter first. The server only checks the proof's shape on entry and verifies it at the
seal, so they are accepted and then excluded as pow_invalid. Together with bots that ran
out of time solving, they are the scorecard's "could not pass proof-of-work".

At the end a scorecard prints in the terminal and opens as a web page for the projector,
with a link to the drop's public Verify page.

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
import webbrowser
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

    async def get(self, url: str, **kw) -> httpx.Response:
        """GETs are safe to repeat: poll through dropped connections and 5xx until the server answers."""
        while (r := await self.req("GET", url, **kw)) is None or r.status_code >= 500:
            await asyncio.sleep(1)
        return r

    def log(self, msg: str) -> None:
        print(f"[{now() - self.t0:6.1f}s] {msg}", flush=True)

    async def find_drop(self) -> dict:
        if self.a.drop:
            return (await self.get(f"/api/drops/{self.a.drop}")).json()
        self.log("waiting for a new drop (click Reset on the demo panel)...")
        seen = {d["drop_id"] for d in (await self.get("/api/drops")).json()["drops"]} if not self.a.use_existing else set()
        while True:
            drops = (await self.get("/api/drops")).json()["drops"]
            fresh = [d for d in drops if d["phase"] in ("scheduled", "open") and d["drop_id"] not in seen]
            if fresh:
                return (await self.get(f"/api/drops/{fresh[-1]['drop_id']}")).json()
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
        bot = {"i": i, "kind": spec["kind"], "token": tok, "h": {"Authorization": f"Bearer {tok}"},
               "cheat": random.random() < self.a.cheaters, "fate": "no_entry"}
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
        if bot["cheat"]:                                          # skip the work, send made-up answers
            nonces = [random.randrange(2**32) for _ in range(ch["k"])]
            self.stats["pow_faked"] += 1
        else:
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
            bot["fate"] = "blocked:network"
            return
        if r.status_code in (200, 201):
            bot["entry_id"] = r.json()["entry_id"]
            bot["fate"] = "entered"
            self.stats["entered"] += 1
        else:
            code = r.json().get("error", r.status_code) if r.headers.get("content-type", "").startswith("application/json") else r.status_code
            self.stats[f"entry_rejected:{code}"] += 1
            bot["fate"] = "too_late" if code == "window_closed" else f"blocked:{code}"

    async def progress(self, total: int, until: asyncio.Event) -> None:
        last = 0
        while not until.is_set():
            s = self.stats
            rate = (s["pow_solved"] - last)
            last = s["pow_solved"]
            rej = sum(v for k, v in s.items() if k.startswith("entry_rejected"))
            self.log(f"PoW solved {s['pow_solved']} + faked {s['pow_faked']} of {total} ({rate}/s solving) | "
                     f"entries accepted {s['entered']} | rejected {rej}")
            try:
                await asyncio.wait_for(until.wait(), 1.0)
            except asyncio.TimeoutError:
                pass

    async def wait_phase(self, did: str, phases: set[str], need_timestamp: bool = False) -> dict:
        while True:
            d = (await self.get(f"/api/drops/{did}")).json()
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
                bot["fate"] = "bought"

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
        excl = (await self.get(f"/api/drops/{did}/exclusions")).content.decode().splitlines()
        reasons = {json.loads(line)["entry_id"]: json.loads(line)["reason"] for line in excl}
        bot_entries = {b["entry_id"]: b for b in self.bots if "entry_id" in b}
        bot_excluded = Counter(reasons[e] for e in bot_entries if e in reasons)
        bot_eligible = [b for e, b in bot_entries.items() if e not in reasons]
        humans_entered = d["counts"]["entries"] - len(bot_entries)
        for e, b in bot_entries.items():
            b["fate"] = f"excluded:{reasons[e]}" if e in reasons else "in_draw"
        snap = d.get("snapshot") or {}
        if snap.get("timestamped_at"):
            margin = parse_ts(d["drand_round_due_at"]) - parse_ts(snap["timestamped_at"])
            took = parse_ts(snap["sealed_at"]) - closes_at
            self.log(f"seal finished {took:.0f}s after close; timestamped {margin:.0f}s before the random round"
                     + ("  <-- TOO CLOSE: use fewer bots or a faster server" if margin < 20 else ""))
        self.log(f"SEAL: {sum(bot_excluded.values())} of {len(bot_entries)} bot entries excluded "
                 f"({', '.join(f'{k} {v}' for k, v in bot_excluded.most_common())}); "
                 f"{len(bot_eligible)} bots still in the draw next to {humans_entered} other entries")

        self.log(f"waiting for the draw (public drand round due {d['drand_round_due_at']})...")
        d = await self.wait_phase(did, {"drawn", "settled"})
        draw = (await self.get(f"/api/drops/{did}/draw")).json()
        ranks = {e: i + 1 for i, e in enumerate(draw["ranked_entry_ids"])}
        winners = {a["entry_id"] for a in draw["allocation"]}
        bot_winners = [b for b in bot_eligible if b["entry_id"] in winners]
        human_winners = len(winners - set(bot_entries))
        ahead = next((i for i, e in enumerate(draw["ranked_entry_ids"]) if e in bot_entries), len(draw["ranked_entry_ids"]))
        self.log(f"DRAW: {len(winners)} offers | {len(bot_winners)} to bots | {human_winners} to everyone else")

        offers = []
        for b in bot_winners:
            me = (await self.get(f"/api/drops/{did}/me", headers=b["h"])).json()
            if me.get("offer"):
                offers.append((b, me["offer"]))
        if offers and d.get("seat_selection"):
            self.log(f"{len(offers)} winning bots now hammer the best seats...")
            await asyncio.gather(*(self.attack_seats(b, d, o) for b, o in offers))
        elif offers:
            for b, o in offers:
                order = str(uuid.uuid4())
                await self.req("POST", f"/api/offers/{o['offer_id']}/redeem", headers=b["h"], json={"order_id": order})
                r = await self.req("POST", f"/api/offers/{o['offer_id']}/pay", headers=b["h"],
                                   json={"order_id": order, "result": "success"})
                if r is not None and r.status_code == 200 and r.json().get("status") == "confirmed":
                    self.stats["bot_tickets_bought"] += o["quantity"]
                    b["fate"] = "bought"

        refused = {k.split(":", 1)[1]: v for k, v in self.stats.items() if k.startswith("seat_refused:")}
        fates = Counter(b["fate"] for b in self.bots)
        logins_failed = self.a.bots - len(self.bots)
        pow_failed = fates["too_late"] + fates["excluded:pow_invalid"] + fates["excluded:pow_missing"]
        rule_excluded = {k.split(":", 1)[1]: v for k, v in fates.items() if k.startswith("excluded:sybil:")}
        blocked = {k.split(":", 1)[1]: v for k, v in fates.items() if k.startswith("blocked:")}
        bots_bought = fates["bought"]
        report = {
            "drop_id": did, "drop_name": drop["name"], "site": self.a.site or self.a.base,
            "finished_at": datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC"),
            "bots_launched": self.a.bots, "identities": dict(kinds),
            "cheater_bots": sum(b["cheat"] for b in self.bots), "logins_failed": logins_failed,
            "pow": {"solved": self.stats["pow_solved"], "faked": self.stats["pow_faked"],
                    "ran_out_of_time": fates["too_late"], "forged_proof_rejected_at_seal": fates["excluded:pow_invalid"],
                    "could_not_pass_pow": pow_failed},
            "blocked_at_entry": blocked,
            "excluded_by_anti_bot_rules": rule_excluded,
            "bot_entries_accepted": len(bot_entries), "bots_left_in_draw": len(bot_eligible),
            "other_entries": humans_entered, "offers_total": len(winners), "offers_to_bots": len(bot_winners),
            "offers_to_others": human_winners, "other_entries_ranked_ahead_of_every_bot": ahead,
            "seat_attempts_refused": refused,
            "bots_that_bought": bots_bought, "bot_tickets_bought": self.stats["bot_tickets_bought"],
            "bots_with_no_ticket": self.a.bots - bots_bought,
        }
        w = 32
        print("\n===================  BOT SWARM SCORECARD  ===================")
        print(f" {'X  bots launched':{w}}{self.a.bots}  ({kinds['farm']} farm, {kinds['expensive']} expensive, "
              f"{report['cheater_bots']} cheaters)")
        print(f" {'Z  could not pass proof-of-work':{w}}{pow_failed}  ({fates['too_late']} ran out of time, "
              f"{fates['excluded:pow_invalid']} forged proofs rejected)")
        print(f" {'Y  excluded by anti-bot rules':{w}}{sum(rule_excluded.values())}  ("
              + ", ".join(f"{k}: {v}" for k, v in sorted(rule_excluded.items())) + ")")
        if blocked or logins_failed:
            print(f" {'   blocked at the door':{w}}{sum(blocked.values()) + logins_failed}  "
                  + ", ".join(f"{k}: {v}" for k, v in blocked.items())
                  + (f" failed logins: {logins_failed}" if logins_failed else ""))
        print(f" {'   bots left in the draw':{w}}{len(bot_eligible)}  (each with one person's odds per ticket)")
        print(f" {'   offers: bots / others':{w}}{len(bot_winners)} / {human_winners}   "
              f"({ahead} of {humans_entered} real entries ranked ahead of every bot)")
        if refused:
            print(f" {'   seat grabs refused':{w}}" + ", ".join(f"{k}: {v}" for k, v in refused.items()))
        print(f" {'J  tickets the bots bought':{w}}{self.stats['bot_tickets_bought']}  (by {bots_bought} bots)")
        print(f" {'   bots that got nothing':{w}}{self.a.bots - bots_bought} of {self.a.bots}")
        print("==============================================================")
        await self.c.aclose()
        return report


def scorecard_html(r: dict) -> str:
    """A projector-friendly scorecard: the funnel from bots launched to tickets bought."""
    from html import escape
    x = r["bots_launched"]
    stages = [
        ("Bots launched", x, "#A78BFA"),
        ("Got an entry in", r["bot_entries_accepted"], "#818CF8"),
        ("Passed the proof-of-work check", r["bot_entries_accepted"] - r["pow"]["forged_proof_rejected_at_seal"], "#60A5FA"),
        ("Passed the anti-bot rules", r["bots_left_in_draw"], "#F59E0B"),
        ("Won an offer in the draw", r["offers_to_bots"], "#F97316"),
        ("Bought tickets", r["bots_that_bought"], "#EF4444"),
    ]
    bars = "".join(
        f'<div class="row"><span class="lab">{escape(n)}</span><div class="bar"><i style="width:{max(0.6, 100 * v / max(1, x)):.1f}%;'
        f'background:{c}"></i></div><b>{v:,}</b></div>' for n, v, c in stages)
    rules = ", ".join(f"{escape(k)}: {v:,}" for k, v in sorted(r["excluded_by_anti_bot_rules"].items())) or "none"
    blocked = ", ".join(f"{escape(k)}: {v:,}" for k, v in r["blocked_at_entry"].items())
    verify = f'{escape(r["site"].rstrip("/"))}/#/verify/{escape(r["drop_id"])}'
    tiles = [
        ("X", "bots launched", x, f'{r["identities"].get("farm", 0):,} farm · {r["identities"].get("expensive", 0):,} expensive · {r["cheater_bots"]:,} cheaters'),
        ("Z", "could not pass proof-of-work", r["pow"]["could_not_pass_pow"],
         f'{r["pow"]["ran_out_of_time"]:,} ran out of time · {r["pow"]["forged_proof_rejected_at_seal"]:,} forged proofs rejected'),
        ("Y", "excluded by anti-bot rules", sum(r["excluded_by_anti_bot_rules"].values()), rules),
        ("J", "tickets bought by bots", r["bot_tickets_bought"], f'by {r["bots_that_bought"]:,} bots · {r["bots_with_no_ticket"]:,} of {x:,} bots got nothing'),
    ]
    tile_html = "".join(f'<div class="tile"><span class="k">{k}</span><b>{v:,}</b><span class="t">{escape(t)}</span><small>{d}</small></div>'
                        for k, t, v, d in tiles)
    return f"""<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Bot Swarm Scorecard</title><style>
:root{{color-scheme:dark}}body{{margin:0;background:#0A0A10;color:#F4F0FF;font:16px/1.5 system-ui,sans-serif}}
main{{max-width:1100px;margin:0 auto;padding:32px 16px}}h1{{font-size:clamp(28px,5vw,48px);margin:0 0 4px;letter-spacing:-.02em}}
.sub{{color:#9A96A8;margin:0 0 28px}}.tiles{{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:14px;margin-bottom:32px}}
.tile{{border:1px solid #2A2838;background:#12111A;padding:18px;display:grid;gap:4px}}.tile b{{font-size:clamp(36px,6vw,56px);line-height:1}}
.k{{color:#A78BFA;font:600 13px ui-monospace,monospace}}.t{{font-weight:600}}.tile small{{color:#9A96A8}}
h2{{font-size:18px;margin:0 0 12px}}.row{{display:grid;grid-template-columns:minmax(150px,240px) 1fr 70px;gap:12px;align-items:center;margin:8px 0}}
.lab{{color:#C9C5D6}}.bar{{height:22px;background:#1A1924}}.bar i{{display:block;height:100%}}.row b{{text-align:right;font-variant-numeric:tabular-nums}}
.note{{margin-top:28px;border-left:3px solid #A78BFA;padding:4px 14px;color:#C9C5D6}}a{{color:#A78BFA}}
@media (max-width:560px){{.row{{grid-template-columns:1fr 60px}}.bar{{grid-column:1/-1;order:3}}}}
</style></head><body><main>
<h1>Bot swarm vs Fair Drop</h1><p class="sub">{escape(r["drop_name"])} · {escape(r["finished_at"])} · drop {escape(r["drop_id"])}</p>
<div class="tiles">{tile_html}</div>
<h2>What happened to {x:,} bots</h2>{bars}
<p class="sub" style="margin-top:14px">{f"Blocked at the door: {blocked}. " if blocked else ""}Offers: {r["offers_to_bots"]:,} to bots, {r["offers_to_others"]:,} to everyone else; {r["other_entries_ranked_ahead_of_every_bot"]:,} of {r["other_entries"]:,} real entries were ranked ahead of every bot.</p>
<p class="note">Fair Drop doesn't guess who is human. Bots that shared devices or cards, or used new accounts, were excluded by rules published before anyone entered.
Bots that faked the proof-of-work were caught at the seal. The few that survived looked exactly like fans and got one fan's odds per ticket; speed bought them nothing.
Anyone can recompute this draw: <a href="{verify}">{verify}</a></p>
</main></body></html>"""


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
    ap.add_argument("--cheaters", type=float, default=0.1, help="share of bots that fake the proof-of-work")
    ap.add_argument("--site", help="public site for the Verify link (default: the base URL)")
    ap.add_argument("--report", default="bot_swarm_report.json")
    ap.add_argument("--html", default="bot_swarm_scorecard.html")
    ap.add_argument("--no-open", action="store_true", help="don't open the scorecard page in the browser")
    a = ap.parse_args()
    report = asyncio.run(Swarm(a).main())
    Path(a.report).write_text(json.dumps(report, indent=2))
    page = Path(a.html).resolve()
    page.write_text(scorecard_html(report), encoding="utf-8")
    print(f"report: {a.report}   scorecard page: {page}")
    if not a.no_open:
        webbrowser.open(page.as_uri())


if __name__ == "__main__":
    main()
