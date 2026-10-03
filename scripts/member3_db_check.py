"""Apply the shared schema and check its inventory guard.

Usage:
  DATABASE_URL=postgresql://... python scripts/member3_db_check.py --apply
  DATABASE_URL=postgresql://... python scripts/member3_db_check.py --check-inventory
"""

from __future__ import annotations

import argparse
import os
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

import psycopg
from psycopg.errors import CheckViolation

ROOT = Path(__file__).resolve().parents[1]
SCHEMA = ROOT / "contracts" / "schema.sql"


def database_url(argument: str | None) -> str:
    value = argument or os.getenv("DATABASE_URL")
    if not value:
        raise SystemExit("DATABASE_URL or --database-url is required")
    return value


def apply_schema(connection: psycopg.Connection) -> None:
    with connection.cursor() as cursor:
        cursor.execute(SCHEMA.read_text(encoding="utf-8"))
    connection.commit()


def check_inventory_guard(connection: psycopg.Connection) -> None:
    """Prove the DB rejects held units that exceed tier capacity, then roll back."""
    drop_id = uuid.uuid4()
    now = datetime.now(timezone.utc)
    try:
        with connection.transaction():
            with connection.cursor() as cursor:
                cursor.execute(
                    """INSERT INTO drops(drop_id,name,venue,starts_at,opens_at,closes_at,
                           allocation_mode,pow_required,turnstile_required,pow_bits,drand_chain,
                           drand_round,config_hash)
                       VALUES(%s,'constraint test','local',%s,%s,%s,'lottery_wil',false,false,0,
                              'quicknet',1,%s)""",
                    (drop_id, now + timedelta(days=1), now, now + timedelta(hours=1), "0" * 64),
                )
                cursor.execute(
                    """INSERT INTO tiers(drop_id,tier_id,name,price_paise,capacity,held)
                       VALUES(%s,'test','Test',100,1,1)""", (drop_id,)
                )
                try:
                    cursor.execute("UPDATE tiers SET held=2 WHERE drop_id=%s AND tier_id='test'", (drop_id,))
                except CheckViolation:
                    return
                raise RuntimeError("tiers.held accepted a value above capacity")
    finally:
        connection.rollback()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--database-url")
    parser.add_argument("--apply", action="store_true", help="apply the shared Fair Drop schema")
    parser.add_argument("--check-inventory", action="store_true", help="prove the held <= capacity guard")
    args = parser.parse_args()
    if not args.apply and not args.check_inventory:
        parser.error("choose --apply, --check-inventory, or both")
    with psycopg.connect(database_url(args.database_url)) as connection:
        if args.apply:
            apply_schema(connection)
            print("Shared Fair Drop schema applied.")
        if args.check_inventory:
            check_inventory_guard(connection)
            print("Inventory guard verified: held cannot exceed capacity.")


if __name__ == "__main__":
    main()
