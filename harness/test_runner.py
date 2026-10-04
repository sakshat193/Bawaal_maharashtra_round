from pathlib import Path
import asyncio
from datetime import datetime, timezone
from unittest.mock import AsyncMock

import pytest

from harness.profiles import load_users
from harness.runner import _solve_pow, _summarize
from fairdrop_common import pow
from harness import runner


def test_summary_keeps_profile_classification():
    profiles, users = load_users(Path("harness/profiles.yaml"))
    for index, user in enumerate(users):
        user["identity_id"] = f"identity-{index}"
        user["entry_id"] = f"entry-{index}"
    result = _summarize("lottery_wil", users, [], {}, {})
    for name, spec in profiles.items():
        if spec["count"]:
            assert result["profiles"][name]["bot"] is bool(spec.get("bot", False))
            assert result["profiles"][name]["cohort"] == spec.get("cohort", name)


def test_documented_output_is_served_by_frontend():
    readme = Path("harness/README.md").read_text(encoding="utf-8")
    assert "--out frontend/public/results.json" in readme
    assert "web/public/results.json" not in readme


def test_harness_solves_actual_api_challenge_shape():
    parameters = {"challenge": "01" * 32, "bits": 2, "k": 4, "memory_kib": 64}
    nonces = _solve_pow(parameters)
    assert pow.verify(parameters["challenge"], nonces, parameters["bits"], parameters["k"], parameters["memory_kib"])


def test_harness_leaves_time_for_the_whole_population(monkeypatch):
    monkeypatch.setenv("ADMIN_KEY", "test-admin")
    monkeypatch.setattr(runner, "load_users", lambda path: ({}, [{}]))
    monkeypatch.setattr(runner, "_login", AsyncMock(return_value={}))
    monkeypatch.setattr(runner, "FairDropApi", lambda *args: type("Api", (), {"close": AsyncMock()})())
    deadlines, difficulties = [], []

    async def create(api, mode, close_at, pow_bits):
        deadlines.append(close_at)
        difficulties.append(pow_bits)
        raise RuntimeError("stop before creating network drops")

    monkeypatch.setattr(runner, "_create_mode", create)
    before = datetime.now(timezone.utc)
    with pytest.raises(RuntimeError, match="stop before"):
        asyncio.run(runner.run_harness("http://example.test", Path("unused"), Path("unused")))
    assert all((deadline - before).total_seconds() >= 179 for deadline in deadlines)
    assert difficulties == [4, 4, 4]
