from datetime import datetime, timedelta, timezone

from app.entry.seal import build_blobs, compute_exclusions
from fairdrop_common.canonical import exclusions_bytes, parse_snapshot


def test_seal_evaluates_account_age_at_opening():
    opening = datetime(2026, 10, 4, tzinfo=timezone.utc)
    drop = {"opens_at": opening, "pow_required": False,
            "sybil_rules": [{"id": "age", "kind": "min_account_age_s", "value": 86400}]}
    entries = [
        {"entry_id": "01" * 16, "device_hash": "d1", "payment_fingerprint": "p1", "account_created_at": opening - timedelta(days=1)},
        {"entry_id": "02" * 16, "device_hash": "d2", "payment_fingerprint": "p2", "account_created_at": opening - timedelta(seconds=86399)},
    ]
    assert compute_exclusions(drop, entries) == [("02" * 16, "sybil:age")]


def test_seal_encodes_exclusion_pairs_as_canonical_rows():
    drop = {"drop_id": "00000000-0000-0000-0000-000000000001", "config_hash": "00" * 32, "drand_round": 1}
    entries = [{"entry_id": "01" * 16, "accepted_at": datetime(2026, 1, 1, tzinfo=timezone.utc), "tier_id": "main", "quantity": 1}]
    blob, _, snapshot, _, eligible = build_blobs(drop, entries, [("01" * 16, "sybil:age")])
    assert blob == exclusions_bytes([{"entry_id": "01" * 16, "reason": "sybil:age"}])
    assert parse_snapshot(snapshot)[1] == []
    assert eligible == 0
