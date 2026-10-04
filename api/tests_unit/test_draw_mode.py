import asyncio
import uuid
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from unittest.mock import AsyncMock

import pytest

from app import alloc
from fairdrop_common import rank


@pytest.mark.parametrize("mode", ["fcfs", "lottery_wil", "unknown"])
def test_draw_uses_committed_allocation_mode(monkeypatch, mode):
    drop_id = uuid.UUID("00000000-0000-0000-0000-000000000001")
    entries = [
        {"entry_id": "01" * 16, "tier_id": "main", "quantity": 1, "accepted_at": "2026-01-01T00:00:02Z"},
        {"entry_id": "02" * 16, "tier_id": "main", "quantity": 1, "accepted_at": "2026-01-01T00:00:01Z"},
    ]
    proof_time = datetime(2020, 1, 1, tzinfo=timezone.utc)
    # SELECT results: lock, existing draw, sealed snapshot, lock, existing draw, seal guard,
    # seat config (offer_ttl_s, seat_selection, seat_wave_size, seat_wave_s).
    one = AsyncMock(side_effect=[(True,), None, (1, "sealed", b"snapshot", {"proof": 1}, proof_time, mode),
                                (True,), None, ("sealed", {"proof": 1}, proof_time), (600, False, 25, 30)])
    monkeypatch.setattr(alloc, "_one", one)
    monkeypatch.setattr(alloc, "_all", AsyncMock(return_value=[("main", 2, 0)]))
    monkeypatch.setattr(alloc, "fetch_drand", AsyncMock(return_value={"signature": "ab", "randomness": "00" * 32}))
    monkeypatch.setattr(alloc.canonical, "parse_snapshot", lambda blob: ({}, entries))

    @asynccontextmanager
    async def transaction():
        yield

    connection = AsyncMock()
    connection.transaction = transaction
    if mode == "unknown":
        with pytest.raises(ValueError, match="allocation mode"):
            asyncio.run(alloc._draw_drop(connection, drop_id))
        connection.execute.assert_not_awaited()
        return
    assert asyncio.run(alloc._draw_drop(connection, drop_id))
    expected = rank.fcfs_order(entries) if mode == "fcfs" else rank.lottery_order(entries, drop_id, "00" * 32)
    written = [call.args[1][1] for call in connection.execute.await_args_list if "INSERT INTO ranks" in call.args[0]]
    assert written == [entry["entry_id"] for entry in expected]
