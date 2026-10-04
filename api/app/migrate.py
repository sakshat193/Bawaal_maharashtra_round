"""Apply contracts/schema.sql once, then each contracts/migrations/*.sql once, in name order.

Run: python -m app.migrate
"""
import os
import sys
from pathlib import Path

import psycopg

from .config import REPO_ROOT, get_settings

SCHEMA = Path(os.environ.get("SCHEMA_PATH", REPO_ROOT / "contracts" / "schema.sql"))
MIGRATIONS = Path(os.environ.get("MIGRATIONS_PATH", REPO_ROOT / "contracts" / "migrations"))
LOCK = "SELECT pg_advisory_{}(hashtextextended('fairdrop-migrate', 0))"


def migrate(database_url: str | None = None) -> bool:
    """Returns True if anything was applied, False if the database was already current."""
    applied = False
    with psycopg.connect(database_url or get_settings().database_url, autocommit=True) as conn:
        conn.execute(LOCK.format("lock"))          # serialise concurrent migrators
        try:
            if conn.execute("SELECT to_regclass('public.drops')").fetchone()[0] is None:
                with conn.transaction():
                    conn.execute(SCHEMA.read_text(encoding="utf-8"))
                applied = True
            # ponytail: additive upgrades inline; adopt a migration tool when one is not additive
            conn.execute("ALTER TABLE entries ADD COLUMN IF NOT EXISTS client_subnet TEXT")
            conn.execute("CREATE TABLE IF NOT EXISTS schema_migrations "
                         "(name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())")
            done = {r[0] for r in conn.execute("SELECT name FROM schema_migrations")}
            for path in sorted(MIGRATIONS.glob("*.sql")) if MIGRATIONS.is_dir() else []:
                if path.name not in done:
                    with conn.transaction():
                        conn.execute(path.read_text(encoding="utf-8"))
                        conn.execute("INSERT INTO schema_migrations (name) VALUES (%s)", (path.name,))
                    applied = True
        finally:
            conn.execute(LOCK.format("unlock"))
    return applied


if __name__ == "__main__":
    print("schema updated" if migrate() else "schema already current")
    sys.exit(0)
