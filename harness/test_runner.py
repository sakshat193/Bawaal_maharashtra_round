from pathlib import Path
import asyncio
import hashlib
import httpx
from datetime import datetime, timezone
from unittest.mock import AsyncMock

import pytest

from harness.profiles import load_users
from harness.runner import _invariant_summary, _solve_pow, _summarize
from fairdrop_common import pow
from harness import runner


def test_summary_keeps_profile_classification():
    profiles, users = load_users(Path("harness/profiles.yaml"))
    for index, user in enumerate(users):
        user["identity_id"] = f"identity-{index}"
        user["entry_id"] = f"entry-{index}"
    result = _summarize("lottery_wil", users, [], {}, {}, [])
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
    assert difficulties == [4]


def test_each_mode_opens_after_previous_population_is_registered(monkeypatch, tmp_path):
    monkeypatch.setenv('ADMIN_KEY', 'test-admin')
    monkeypatch.setattr(runner, 'load_users', lambda path: ({}, [{}]))
    monkeypatch.setattr(runner, '_login', AsyncMock(return_value={'arrival': 'normal', 'profile': 'x', 'profile_index': 0}))
    monkeypatch.setattr(runner, 'FairDropApi', lambda *args: type('Api', (), {'close': AsyncMock(), 'checked': AsyncMock()})())
    events = []
    async def create(api, mode, close_at, bits):
        events.append(('create', mode))
        return {'drop_id': mode, 'mode': mode, 'drand_round': 1}
    async def register(api, drop, user, pool, semaphore):
        events.append(('register', drop['mode']))
        return user
    async def finish(api, drop):
        return {'mode': drop['mode']}
    monkeypatch.setattr(runner, '_create_mode', create)
    monkeypatch.setattr(runner, '_register', register)
    monkeypatch.setattr(runner, '_finish_mode', finish, raising=False)
    result = asyncio.run(runner.run_harness('http://example.test', Path('unused'), tmp_path / 'results.json'))
    assert events == [(action, mode) for mode in runner.MODES for action in ('create', 'register')]
    assert [mode['mode'] for mode in result['modes']] == list(runner.MODES)


def test_invariants_preserve_real_duplicate_counter():
    value = {"tiers": [{"tier_id": "main", "held": 1, "capacity": 2, "active_offer_units": 1}],
             "oversell": 0, "held_mismatch": 0, "double_redemption": 2}
    assert _invariant_summary(value)["double_redemption"] == 2
    del value["double_redemption"]
    with pytest.raises(RuntimeError, match="double_redemption"):
        _invariant_summary(value)


def test_published_exclusions_bind_rules_and_populate_counts():
    from fairdrop_common import canonical
    profiles, users = load_users(Path('harness/profiles.yaml'))
    for index, user in enumerate(users):
        user['entry_id'] = f'{index:032x}'
    rows = [{'entry_id': user['entry_id'], 'reason': 'sybil:device'}
            for user in users if user['profile'] == 'sybil_cluster']
    blob = canonical.exclusions_bytes(rows)
    api = type('Api', (), {'request': AsyncMock(return_value=httpx.Response(
        200, content=blob, headers={'X-Fairdrop-Exclusions-Sha256': hashlib.sha256(blob).hexdigest()}))})()
    drop = {'drop_id': 'test', 'sybil_rules': [{'id': 'device', 'kind': 'max_per_device', 'limit': 2}]}
    published = asyncio.run(runner._published_exclusions(api, drop, users))
    result = _summarize('lottery_wil', users, [], {}, {}, published)
    assert result['exclusions_per_rule'] == {'sybil:device': profiles['sybil_cluster']['count']}
    api.request.return_value = httpx.Response(200, content=b'', headers={
        'X-Fairdrop-Exclusions-Sha256': hashlib.sha256(b'').hexdigest()})
    with pytest.raises(RuntimeError, match='frozen Sybil rules'):
        asyncio.run(runner._published_exclusions(api, drop, users))
    api.request.return_value = httpx.Response(200, content=blob, headers={'X-Fairdrop-Exclusions-Sha256': '0' * 64})
    with pytest.raises(RuntimeError, match='hash'):
        asyncio.run(runner._published_exclusions(api, drop, users))


def test_profiles_get_synthetic_subnets():
    import ipaddress
    _, users = load_users(Path('harness/profiles.yaml'))
    net = lambda p: {str(ipaddress.ip_network(f"{u['ip']}/24", strict=False)) for u in users if u['profile'] == p}
    assert len(net('sybil_cluster')) == 1 and len(net('speed_bots')) == 1
    assert len(net('honest_singles')) == 30 and len(net('honest_groups')) == 6
    assert all(u['ip'] is None for u in users if u['profile'] == 'replay')
