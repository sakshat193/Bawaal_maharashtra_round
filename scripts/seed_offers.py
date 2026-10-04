"""Seed one isolated drop with offer lifecycle states for Member 3 development.

This deliberately bypasses the entry and draw flows. Use only against a disposable
development database; the script creates and commits one synthetic drop per run.
"""

from __future__ import annotations

import argparse
import os
import uuid
from datetime import datetime, timedelta, timezone

import psycopg

ACTIVE = {"offered", "payment_pending", "confirmed"}
STATUSES = ("offered", "payment_pending", "confirmed", "expired", "declined", "payment_failed")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--drop", help="drop UUID (generated when omitted)")
    parser.add_argument("--entries", type=int, default=24, help="synthetic entries (default: 24)")
    parser.add_argument("--capacity", type=int, default=12, help="capacity in each tier (default: 12)")
    parser.add_argument("--database-url", default=os.getenv("DATABASE_URL"))
    args = parser.parse_args()
    if not args.database_url:
        parser.error("DATABASE_URL or --database-url is required")
    if args.entries < len(STATUSES) or args.capacity < 4:
        parser.error("--entries must be at least 6 and --capacity at least 4")

    drop_id = uuid.UUID(args.drop) if args.drop else uuid.uuid4()
    now = datetime.now(timezone.utc)
    drand_round = max(1, 1 + (int(now.timestamp()) - 1_692_803_367 + 2) // 3)
    tiers = (("gold", 900_000), ("silver", 500_000))
    entries: list[tuple[str, str, int]] = []
    for index in range(args.entries):
        tier_id, quantity = tiers[index % len(tiers)][0], index % 4 + 1
        entries.append((uuid.uuid4().hex, tier_id, quantity))
    held = {tier_id: sum(q for i, (entry_id, t, q) in enumerate(entries)
                         if t == tier_id and i < len(STATUSES) and STATUSES[i] in ACTIVE)
            for tier_id, _price in tiers}
    if any(value > args.capacity for value in held.values()):
        parser.error("active seeded offers exceed capacity; increase --capacity")

    with psycopg.connect(args.database_url) as connection:
        with connection.cursor() as cursor:
            cursor.execute(
                """INSERT INTO drops(drop_id,name,venue,starts_at,opens_at,closes_at,
                       allocation_mode,pow_required,turnstile_required,pow_bits,
                       max_quantity,offer_ttl_s,pay_deadline_s,max_promotion_rounds,
                       sybil_rules,drand_chain,drand_round,config_hash,phase)
                   VALUES(%s,%s,%s,%s,%s,%s,'lottery_wil',false,false,0,4,45,30,3,
                          '[]'::jsonb,%s,%s,%s,'drawn')""",
                (drop_id, "Member 3 offer fixtures", "Local venue", now + timedelta(days=30),
                 now - timedelta(hours=1), now - timedelta(minutes=1),
                 "quicknet", drand_round, "0" * 64),
            )
            for tier_id, price_paise in tiers:
                cursor.execute(
                    """INSERT INTO tiers(drop_id,tier_id,name,price_paise,capacity,held)
                       VALUES(%s,%s,%s,%s,%s,%s)""",
                    (drop_id, tier_id, tier_id.title(), price_paise, args.capacity, held[tier_id]),
                )
            for index, (entry_id, tier_id, quantity) in enumerate(entries):
                identity_id = f"seed-{drop_id.hex}-{index}"
                cursor.execute(
                    """INSERT INTO entries(entry_id,drop_id,identity_id,tier_id,quantity,
                              eligible,accepted_at)
                       VALUES(%s,%s,%s,%s,%s,true,%s)""",
                    (entry_id, drop_id, identity_id, tier_id, quantity, now + timedelta(microseconds=index)),
                )
                if index >= len(STATUSES):
                    continue
                status = STATUSES[index]
                offer_id = uuid.uuid4()
                expires_at = now + timedelta(minutes=5) if status == "offered" else now - timedelta(minutes=1)
                pay_deadline = now + timedelta(minutes=5) if status == "payment_pending" else None
                order_id = str(uuid.uuid4()) if status in {"payment_pending", "confirmed"} else None
                cursor.execute(
                    """INSERT INTO offers(offer_id,drop_id,entry_id,tier_id,quantity,round,
                              status,expires_at,pay_deadline,order_id,confirmed_at)
                       VALUES(%s,%s,%s,%s,%s,0,%s,%s,%s,%s,%s)""",
                    (offer_id, drop_id, entry_id, tier_id, quantity, status, expires_at,
                     pay_deadline, order_id, now if status == "confirmed" else None),
                )
    print(f"Seeded drop {drop_id} with {args.entries} entries and all six offer statuses.")


if __name__ == "__main__":
    main()
