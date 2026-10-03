"""Seal versus entry race, against a real uvicorn server and real Postgres.

Every 201/200 must be in the snapshot or the exclusions; nothing accepted after the
fence may be in either. The plan's done-criterion is 100 passes in a row:
    RACE_REPEAT=100 pytest tests/test_race.py
"""
import json
import os
import threading
import time
from concurrent.futures import ThreadPoolExecutor

import httpx
import psycopg
import pytest

from .conftest import TEST_URL, A, drop_body

REPEAT = int(os.environ.get("RACE_REPEAT", "3"))
USERS = 240
WORKERS = 48


@pytest.mark.parametrize("attempt", range(REPEAT))
def test_seal_vs_entry_race(live_server, attempt):
    with httpx.Client(base_url=live_server.url, timeout=30) as c:
        did = c.post("/api/admin/drops", headers=A, json=drop_body(sybil_rules=[])).json()["drop_id"]
        assert c.post(f"/api/admin/drops/{did}/open", headers=A).status_code == 200
        tokens = [c.post("/platform/login", json={"username": f"r{attempt}-{i}"}).json()["token"]
                  for i in range(USERS)]

    acked, rejected, other = set(), [], []
    lock = threading.Lock()
    start = threading.Event()

    def hammer(tok):
        start.wait()
        with httpx.Client(base_url=live_server.url, timeout=30) as hc:
            r = hc.post(f"/api/drops/{did}/entries", headers={"Authorization": f"Bearer {tok}"},
                        json={"tier_id": "gold", "quantity": 1})
        with lock:
            if r.status_code in (200, 201):
                acked.add(r.json()["entry_id"])
            elif r.status_code == 403 and r.json()["error"] == "window_closed":
                rejected.append(tok)
            else:
                other.append((r.status_code, r.text))

    with ThreadPoolExecutor(WORKERS) as ex:
        futs = [ex.submit(hammer, t) for t in tokens]
        start.set()
        time.sleep(0.05 + 0.02 * (attempt % 5))   # seal lands mid-burst
        with httpx.Client(base_url=live_server.url, timeout=60) as sc:
            seal = sc.post(f"/api/admin/drops/{did}/seal", headers=A)
        for f in futs:
            f.result()
    assert seal.status_code == 200, seal.text
    assert not other, other[:3]

    with httpx.Client(base_url=live_server.url, timeout=30) as c:
        snap = c.get(f"/api/drops/{did}/snapshot").content.decode().splitlines()[1:]
        excl = c.get(f"/api/drops/{did}/exclusions").content.decode().splitlines()
    published = {json.loads(l)["entry_id"] for l in snap} | {json.loads(l)["entry_id"] for l in excl}

    assert acked <= published, f"acknowledged but missing from the seal: {acked - published}"
    with psycopg.connect(TEST_URL) as db:
        stored = {r[0] for r in db.execute("SELECT entry_id FROM entries WHERE drop_id=%s", (did,))}
    assert published == stored == acked, "sealed set must be exactly the acknowledged entries"
    assert len(acked) + len(rejected) == USERS
    print(f"race {attempt}: {len(acked)} acknowledged, {len(rejected)} rejected after the fence")
