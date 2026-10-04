from datetime import datetime, timedelta, timezone

from app.entry.seal import compute_exclusions


def test_seal_evaluates_account_age_at_opening():
    opening = datetime(2026, 10, 4, tzinfo=timezone.utc)
    drop = {"opens_at": opening, "pow_required": False,
            "sybil_rules": [{"id": "age", "kind": "min_account_age_s", "value": 86400}]}
    entries = [
        {"entry_id": "01" * 16, "device_hash": "d1", "payment_fingerprint": "p1", "account_created_at": opening - timedelta(days=1)},
        {"entry_id": "02" * 16, "device_hash": "d2", "payment_fingerprint": "p2", "account_created_at": opening - timedelta(seconds=86399)},
    ]
    assert compute_exclusions(drop, entries) == [("02" * 16, "sybil:age")]
