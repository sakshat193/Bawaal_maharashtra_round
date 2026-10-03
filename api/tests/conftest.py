"""Tests run against a real Postgres 16 (docker compose up -d postgres), never SQLite:
SQLite serialises writers, so race tests would pass whether or not the code is right.

A throwaway database fairdrop_test is created on the compose Postgres (port 5433).
Override with TEST_DATABASE_URL / TEST_ADMIN_URL.
"""
import os
import socket
import threading
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

import psycopg
import pytest

ADMIN_URL = os.environ.get("TEST_ADMIN_URL", "postgresql://fairdrop:fairdrop@localhost:5433/fairdrop")
TEST_URL = os.environ.get("TEST_DATABASE_URL", "postgresql://fairdrop:fairdrop@localhost:5433/fairdrop_test")
ADMIN_KEY = "test-admin-key-0123456789"

os.environ.update({
    "DATABASE_URL": TEST_URL, "ADMIN_KEY": ADMIN_KEY, "DEMO_MODE": "false",
    "RATE_LIMIT_ENABLED": "false", "SCHEDULER_ENABLED": "false", "POW_WORKERS": "2",
})
REPO = Path(__file__).resolve().parents[2]
for var, name in (("PLATFORM_KEY_FILE", "platform_ed25519.pem"), ("RECEIPT_KEY_FILE", "receipt_ed25519.pem"),
                  ("POW_KEY_FILE", "pow_hmac.key")):
    os.environ.setdefault(var, str(REPO / "keys" / name))

from app import db  # noqa: E402
from app.entry import seal as sealmod  # noqa: E402
from app.entry.timestamp import Composite, DevClockOnly  # noqa: E402
from app.migrate import migrate  # noqa: E402

A = {"X-Admin-Key": ADMIN_KEY}


def iso(d: datetime) -> str:
    return d.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


@pytest.fixture(scope="session", autouse=True)
def database():
    name = TEST_URL.rsplit("/", 1)[1]
    with psycopg.connect(ADMIN_URL, autocommit=True) as c:
        c.execute(f'DROP DATABASE IF EXISTS "{name}" WITH (FORCE)')
        c.execute(f'CREATE DATABASE "{name}"')
    assert migrate(TEST_URL)
    yield
    db.close_pool()


@pytest.fixture(autouse=True)
def clean(database):
    with psycopg.connect(TEST_URL, autocommit=True) as c:
        c.execute("TRUNCATE offers, ranks, draws, snapshots, entries, tiers, drops CASCADE")
    yield


@pytest.fixture(autouse=True)
def offline_timestamps(monkeypatch):
    """Tests never call real calendars; individual tests can override."""
    monkeypatch.setattr(sealmod, "timestamper_from_settings", lambda: Composite([DevClockOnly()]))


@pytest.fixture(scope="session")
def client(database):
    from fastapi.testclient import TestClient
    from app.main import app
    with TestClient(app) as c:
        yield c


class _Server:
    def __init__(self):
        import uvicorn
        from app.main import app
        with socket.socket() as s:
            s.bind(("127.0.0.1", 0))
            self.port = s.getsockname()[1]
        self.url = f"http://127.0.0.1:{self.port}"
        self.server = uvicorn.Server(uvicorn.Config(app, port=self.port, log_level="warning",
                                                   limit_concurrency=1000))
        self.thread = threading.Thread(target=self.server.run, daemon=True)

    def start(self):
        self.thread.start()
        deadline = time.time() + 15
        while not self.server.started:
            assert time.time() < deadline, "server did not start"
            time.sleep(0.05)
        return self

    def stop(self):
        self.server.should_exit = True
        self.thread.join(timeout=15)


@pytest.fixture
def live_server(database):
    s = _Server().start()
    yield s
    s.stop()


def drop_body(**over) -> dict:
    now = datetime.now(timezone.utc).replace(microsecond=0)
    body = {
        "name": "Test Drop", "venue": "Test Hall", "starts_at": iso(now + timedelta(days=7)),
        "opens_at": iso(now - timedelta(seconds=5)), "closes_at": iso(now + timedelta(minutes=30)),
        "allocation_mode": "lottery_wil", "pow_required": False, "turnstile_required": False,
        "pow_bits": 2, "pow_k": 4, "pow_memory_kib": 64,
        "sybil_rules": [{"id": "device", "kind": "max_per_device", "limit": 2},
                        {"id": "payment", "kind": "max_per_payment", "limit": 2},
                        {"id": "fresh", "kind": "min_account_age_s", "value": 86400}],
        "tiers": [{"tier_id": "gold", "name": "Gold", "price_paise": 450000, "capacity": 50},
                  {"tier_id": "silver", "name": "Silver", "price_paise": 200000, "capacity": 100}],
    }
    body.update(over)
    return body


def make_open_drop(client, **over) -> str:
    r = client.post("/api/admin/drops", headers=A, json=drop_body(**over))
    assert r.status_code == 201, r.text
    did = r.json()["drop_id"]
    assert client.post(f"/api/admin/drops/{did}/open", headers=A).status_code == 200
    return did


def login(client, username: str, **knobs) -> dict:
    r = client.post("/platform/login", json={"username": username, **knobs})
    assert r.status_code == 200, r.text
    return {"Authorization": "Bearer " + r.json()["token"]}
