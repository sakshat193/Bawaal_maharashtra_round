"""Write synthetic eligible entries straight into the database and seal, so Member 3 can
build the draw against realistic volume. Owner: Member 2.

  python scripts/seed_entries.py --n 50000                 # creates a seed drop, seeds, seals
  python scripts/seed_entries.py --drop <uuid> --n 50000   # seeds an existing open/scheduled drop
  python scripts/seed_entries.py --n 2000 --sybil 40       # also plant a 40-identity Sybil cluster

Uses DATABASE_URL (default: the compose Postgres on localhost:5433). The seal uses a
DEV-ONLY clock "timestamp" unless --real-timestamp is given; never use the dev stamp
for a drop anyone will verify. Round R is due about 90 seconds after the seal, so the
draw has to wait for it like a real one.
"""
import argparse
import random
import sys
import time
import uuid
from datetime import timedelta
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO / "api"))

import psycopg  # noqa: E402

from app.config import get_settings  # noqa: E402
from app.entry import seal as sealmod  # noqa: E402
from app.entry.drops import CreateDrop, create_drop  # noqa: E402
from app.entry.timestamp import Composite, DevClockOnly  # noqa: E402
from app.timefmt import iso_s, utcnow  # noqa: E402

QTY_WEIGHTS = [(1, 50), (2, 30), (3, 10), (4, 10)]


def seed_drop(conn) -> uuid.UUID:
    now = utcnow().replace(microsecond=0)
    req = CreateDrop(
        name="Seeded Drop", venue="Synthetic Stadium", starts_at=now + timedelta(days=14),
        opens_at=now - timedelta(hours=1), closes_at=now, allocation_mode="lottery_wil",
        pow_required=False, turnstile_required=False, pow_bits=0, offer_ttl_s=600, pay_deadline_s=300,
        sybil_rules=[{"id": "device", "kind": "max_per_device", "limit": 2},
                     {"id": "payment", "kind": "max_per_payment", "limit": 2},
                     {"id": "fresh", "kind": "min_account_age_s", "value": 86400}],
        tiers=[{"tier_id": "gold", "name": "Gold", "price_paise": 450000, "capacity": 2000},
               {"tier_id": "silver", "name": "Silver", "price_paise": 200000, "capacity": 6000}],
    )
    return create_drop(conn, req)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--drop", type=uuid.UUID)
    ap.add_argument("--n", type=int, default=50000)
    ap.add_argument("--sybil", type=int, default=0, help="plant a cluster sharing one device and card")
    ap.add_argument("--seed", type=int, default=1)
    ap.add_argument("--real-timestamp", action="store_true", help="stamp with the configured backends")
    ap.add_argument("--no-seal", action="store_true")
    a = ap.parse_args()
    rng = random.Random(a.seed)

    with psycopg.connect(get_settings().database_url, autocommit=True) as conn:
        drop_id = a.drop or seed_drop(conn)
        d = conn.execute("SELECT phase, pow_required, opens_at, closes_at FROM drops WHERE drop_id=%s",
                         (drop_id,)).fetchone()
        if d is None:
            sys.exit(f"no drop {drop_id}")
        phase, pow_required, opens_at, closes_at = d
        if phase not in ("scheduled", "open"):
            sys.exit(f"drop {drop_id} is already {phase}")
        if pow_required:
            sys.exit("seeded entries carry no proof-of-work; use a drop with pow_required=false")
        tiers = conn.execute("SELECT tier_id, capacity FROM tiers WHERE drop_id=%s ORDER BY tier_id",
                             (drop_id,)).fetchall()
        tier_ids, tier_w = [t[0] for t in tiers], [max(1, t[1]) for t in tiers]
        span = max(1.0, (min(closes_at, utcnow()) - opens_at).total_seconds())
        old = opens_at - timedelta(days=900)

        t0 = time.time()
        with conn.transaction(), conn.cursor() as cur:
            with cur.copy("COPY entries (entry_id, drop_id, identity_id, tier_id, quantity, account_created_at, "
                          "device_hash, payment_fingerprint, accepted_at) FROM STDIN") as cp:
                for i in range(a.n + a.sybil):
                    bot = i >= a.n
                    cp.write_row((
                        "%032x" % rng.getrandbits(128), drop_id, f"seed_{a.seed}_{i}",
                        rng.choices(tier_ids, tier_w)[0],
                        4 if bot else rng.choices([q for q, _ in QTY_WEIGHTS], [w for _, w in QTY_WEIGHTS])[0],
                        old + timedelta(days=rng.randrange(800)),
                        "farm-device" if bot else f"dev_{i}", "farm-card" if bot else f"pay_{i}",
                        opens_at + timedelta(microseconds=rng.randrange(int(span * 1_000_000))),
                    ))
        print(f"inserted {a.n + a.sybil} entries into {drop_id} in {time.time() - t0:.1f}s")

    if a.no_seal:
        return
    t0 = time.time()
    r = sealmod.seal(drop_id, timestamper=None if a.real_timestamp else Composite([DevClockOnly()]))
    print(f"sealed in {time.time() - t0:.1f}s: {r.eligible} eligible, {r.excluded} excluded")
    print(f"snapshot {r.canonical_hash}  timestamped_at {iso_s(r.timestamped_at)}")
    print(f"drop_id {drop_id}")


if __name__ == "__main__":
    main()
