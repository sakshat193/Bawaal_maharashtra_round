"""Add 60 labeled demo events through the authenticated admin API, without resets.

python scripts/seed_catalog.py --base https://fairdrop-api.onrender.com \
    --env-file .env.production.local

Stable UUIDs make reruns skip existing events. Existing entries are never modified.
"""

import argparse
import json
import os
import sys
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import urlparse
from urllib.request import Request, urlopen


EVENTS = (
    "Monsoon Indie Sessions", "Deccan Electronic Nights", "Marathi Folk Festival",
    "Jazz Under the Stars", "Desi Hip Hop Showcase", "Acoustic Sunday",
    "Classical Sunrise", "Rock the Fort", "Sufi Courtyard", "Synthwave Social",
    "Brass and Blues", "Bollywood Unplugged", "Coastal Rhythm Festival",
    "Vinyl Listening Club", "Dhol Tasha Live", "Strings at Sundown",
    "Bassline Warehouse", "Poetry and Piano", "Fusion Collective", "Soulful Saturdays",
)
VENUES = (
    ("Mumbai", "Harbour Stage"), ("Pune", "Deccan Amphitheatre"),
    ("Nagpur", "Orange City Arena"), ("Nashik", "Vineyard Pavilion"),
    ("Aurangabad", "Heritage Courtyard"), ("Kolhapur", "Riverside Grounds"),
)
NAMESPACE = uuid.uuid5(uuid.NAMESPACE_URL, "https://fairdrop.example/demo-catalog/v1")


def iso(value):
    return value.isoformat(timespec="seconds").replace("+00:00", "Z")


def catalog(now):
    for index in range(60):
        city, venue = VENUES[index % len(VENUES)]
        title = EVENTS[index % len(EVENTS)]
        edition = index // len(EVENTS) + 1
        opens = now - timedelta(hours=1, minutes=index) if index < 40 else now + timedelta(days=index - 39)
        closes = now + timedelta(days=3 + index % 12, hours=index % 8) if index < 40 else opens + timedelta(days=5)
        price = (499 + (index % 8) * 250) * 100
        capacity = 150 + (index % 10) * 100
        yield {
            "drop_id": str(uuid.uuid5(NAMESPACE, str(index))),
            "name": f"{title} / {city} Vol. {edition} [Demo]",
            "venue": f"{venue}, {city} (demo venue)",
            "starts_at": iso(closes + timedelta(days=7 + index % 5)),
            "opens_at": iso(opens), "closes_at": iso(closes),
            "allocation_mode": "lottery_wil", "pow_required": True,
            "turnstile_required": False, "pow_bits": 8,
            "max_quantity": 4, "offer_ttl_s": 600, "pay_deadline_s": 300,
            "sybil_rules": [
                {"id": "device", "kind": "max_per_device", "limit": 2},
                {"id": "payment", "kind": "max_per_payment", "limit": 2},
            ],
            "tiers": [
                {"tier_id": "general", "name": "General admission", "price_paise": price, "capacity": capacity},
                {"tier_id": "premium", "name": "Premium", "price_paise": price * 2, "capacity": capacity // 3},
                {"tier_id": "vip", "name": "VIP", "price_paise": price * 4, "capacity": max(25, capacity // 10)},
            ],
        }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base", required=True)
    parser.add_argument("--env-file", type=Path)
    args = parser.parse_args()
    base = args.base.rstrip("/")
    if urlparse(base).scheme != "https":
        parser.error("--base must use HTTPS to protect the admin credential")
    key = os.getenv("ADMIN_KEY", "")
    if args.env_file:
        for line in args.env_file.read_text(encoding="utf-8-sig").splitlines():
            if line.strip().startswith("ADMIN_KEY="):
                key = line.strip().split("=", 1)[1].strip().strip("\"'")
    if len(key) < 16:
        parser.error("provide ADMIN_KEY through the environment or --env-file")

    def request(path, body=None):
        headers = {"Content-Type": "application/json"}
        if body is not None:
            headers["X-Admin-Key"] = key
        req = Request(base + path, data=None if body is None else json.dumps(body).encode(), headers=headers)
        with urlopen(req, timeout=90) as response:
            return json.load(response)

    existing = {drop["drop_id"] for drop in request("/api/drops")["drops"]}
    now = datetime.now(timezone.utc).replace(microsecond=0)
    created = skipped = 0
    for event in catalog(now):
        if event["drop_id"] in existing:
            skipped += 1
            continue
        try:
            drop = request("/api/admin/drops", event)
        except HTTPError as error:
            if error.code == 409:
                skipped += 1
                continue
            raise
        created += 1
        if event["opens_at"] <= iso(now) and drop["phase"] == "scheduled":
            try:
                request(f"/api/admin/drops/{drop['drop_id']}/open", {})
            except HTTPError as error:
                # The scheduler can open this event between create and open.
                if error.code != 409:
                    raise
        print(f"Created {created}: {event['name']}", flush=True)
    print(f"Complete: {created} created, {skipped} already present.")


if __name__ == "__main__":
    try:
        main()
    except HTTPError as error:
        print(f"API returned HTTP {error.code}; rerun safely after resolving the error.", file=sys.stderr)
        sys.exit(1)
    except (URLError, OSError, ValueError) as error:
        print(f"Seeding stopped ({type(error).__name__}); rerun safely after resolving the error.", file=sys.stderr)
        sys.exit(1)
