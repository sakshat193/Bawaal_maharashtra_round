import asyncio
from datetime import datetime, timedelta, timezone

import httpx

from harness import attacks


def test_payment_failure_runs_before_late_payer_wait(monkeypatch):
    names = ("replay", "forged_redeem", "double_redeem", "late_payer", "payment_failer", "reconnect")
    users = [{"action": name, "token": name, "username": name, "risk": {}} for name in names]
    events = []
    expiry = (datetime.now(timezone.utc) + timedelta(seconds=45)).isoformat()
    redeemed = set()

    class Api:
        @staticmethod
        def payload(response):
            return response.json()

        async def checked(self, method, path, **kwargs):
            if path == "/platform/login":
                return {"token": "reconnect"}
            token = kwargs["token"]
            return {"phase": "drawn", "entry": {"entry_id": token}, "offer": {"offer_id": token, "expires_at": expiry}}

        async def request(self, method, path, token, body):
            if path.endswith("/redeem"):
                if token == "replay":
                    return httpx.Response(403, json={"error": "offer_not_yours"})
                if token == "forged_redeem":
                    return httpx.Response(409, json={"error": "not_offered"})
                if token in redeemed:
                    return httpx.Response(409, json={"error": "already_redeemed_other_order"})
                if token == "payment_failer" and "wait" in events:
                    return httpx.Response(409, json={"error": "offer_expired"})
                redeemed.add(token)
                return httpx.Response(200, json={"status": "payment_pending"})
            events.append(f"pay:{token}")
            return httpx.Response(200, json={"status": "payment_failed" if body["result"] == "fail" else "confirmed"})

    async def sleep(seconds):
        events.append("wait")

    monkeypatch.setattr(attacks.asyncio, "sleep", sleep)
    results = asyncio.run(attacks.run_attacks(Api(), "drop", users))
    assert results["payment_failer"]["passed"]
    assert events.index("pay:payment_failer") < events.index("wait")
    assert all(check["passed"] for check in results.values())
