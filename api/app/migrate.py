"""Apply contracts/schema.sql once. Run: python -m app.migrate"""
import os
import sys
from pathlib import Path

import psycopg

from .config import REPO_ROOT, get_settings

SCHEMA = Path(os.environ.get("SCHEMA_PATH", REPO_ROOT / "contracts" / "schema.sql"))


def migrate(database_url: str | None = None) -> bool:
    """Returns True if the schema was applied, False if it already existed."""
    with psycopg.connect(database_url or get_settings().database_url) as conn:
        if conn.execute("SELECT to_regclass('public.drops')").fetchone()[0] is not None:
            # ponytail: additive upgrades inline; adopt a migration tool when one is not additive
            conn.execute("ALTER TABLE entries ADD COLUMN IF NOT EXISTS client_subnet TEXT")
            return False
        with conn.transaction():
            conn.execute(SCHEMA.read_text(encoding="utf-8"))
        return True


if __name__ == "__main__":
    applied = migrate()
    print("schema applied" if applied else "schema already present")
    sys.exit(0)
