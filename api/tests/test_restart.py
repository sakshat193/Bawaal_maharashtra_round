"""Restart mid-sale (Member 2's cross-seam test, entry side): killing the API during the
window loses no entry, and a retry after the restart gets the identical receipt.

The payment-window and after-draw halves belong with Member 3's routes once they land.
"""
import json

import httpx

from .conftest import A, _Server, drop_body


def _login(c, u):
    return {"Authorization": "Bearer " + c.post("/platform/login", json={"username": u}).json()["token"]}


def _enter(c, did, h):
    r = c.post(f"/api/drops/{did}/entries", headers=h, json={"tier_id": "gold", "quantity": 2})
    assert r.status_code in (200, 201), r.text
    return r


def test_restart_during_window_loses_nothing(database):
    first = _Server().start()
    with httpx.Client(base_url=first.url, timeout=30) as c:
        did = c.post("/api/admin/drops", headers=A, json=drop_body(sybil_rules=[])).json()["drop_id"]
        c.post(f"/api/admin/drops/{did}/open", headers=A)
        before = {u: _enter(c, did, _login(c, u)).json() for u in (f"pre{i}" for i in range(20))}
    first.stop()                                    # the API dies mid-window

    second = _Server().start()
    try:
        with httpx.Client(base_url=second.url, timeout=30) as c:
            for u, receipt in before.items():       # retries after the restart: same receipt, 200
                r = _enter(c, did, _login(c, u))
                assert r.status_code == 200 and r.json() == receipt
            after = [_enter(c, did, _login(c, f"post{i}")).json()["entry_id"] for i in range(20)]
            assert c.post(f"/api/admin/drops/{did}/seal", headers=A).status_code == 200
            snap = c.get(f"/api/drops/{did}/snapshot").text.splitlines()[1:]
        sealed = {json.loads(l)["entry_id"] for l in snap}
        assert sealed == {r["entry_id"] for r in before.values()} | set(after)
    finally:
        second.stop()
