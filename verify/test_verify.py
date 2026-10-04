import base64
import hashlib
import json

import httpx
import pytest

from fairdrop_common.canonical import snapshot_bytes
from verify import verify as verifier


@pytest.mark.parametrize("proof_kind", ["ots", "git", "wrong_hash", "empty", "malformed"])
def test_verifier_consumes_live_evidence(monkeypatch, proof_kind):
    drop_id = "00000000-0000-0000-0000-000000000001"
    entry = {"entry_id": "01" * 16, "tier_id": "main", "quantity": 1, "accepted_at": "2026-01-01T00:00:00.000000Z"}
    exclusions_hash = hashlib.sha256(b"").hexdigest()
    blob = snapshot_bytes({"version": "fairdrop-snapshot/2", "drop_id": drop_id, "config_hash": "00" * 32,
                           "exclusions_hash": exclusions_hash, "drand_round": 40000000}, [entry])
    snapshot_hash = hashlib.sha256(blob).hexdigest()
    proof = {"snapshot_sha256": snapshot_hash, "ots": {"calendars": [{"url": "https://calendar.example"}]}}
    if proof_kind == "git":
        proof = {"snapshot_sha256": snapshot_hash, "git": {"commit": "abc"}}
    elif proof_kind == "wrong_hash":
        proof["snapshot_sha256"] = "ff" * 32
    elif proof_kind == "empty":
        proof["ots"]["calendars"] = []
    encoded = "!!!" if proof_kind == "malformed" else base64.b64encode(json.dumps(proof).encode()).decode()
    headers = {"content-type": "application/x-ndjson; charset=utf-8", "x-fairdrop-snapshot-sha256": snapshot_hash,
               "x-fairdrop-exclusions-sha256": exclusions_hash, "x-fairdrop-timestamped-at": "2026-01-01T00:00:00Z",
               "x-fairdrop-timestamp-proof": encoded}
    beacon = {"round": 40000000, "signature": "ab", "randomness": hashlib.sha256(bytes.fromhex("ab")).hexdigest()}

    def response(request):
        path = request.url.path
        if path.endswith("/snapshot"):
            return httpx.Response(200, content=blob, headers=headers)
        if path.endswith("/exclusions"):
            return httpx.Response(200, content=b"", headers=headers)
        if path.endswith("/draw"):
            return httpx.Response(200, json={**beacon, "ranked_entry_ids": [entry["entry_id"]],
                "allocation": [{**entry, "round": 0}, {"entry_id": "02" * 16, "round": 1}]})
        if "/public/" in path:
            return httpx.Response(200, json=beacon)
        return httpx.Response(200, json={"drand_round": 40000000, "allocation_mode": "fcfs", "tiers": [{"tier_id": "main", "capacity": 1}]})

    client = httpx.Client(transport=httpx.MockTransport(response))
    monkeypatch.setattr(verifier.httpx, "Client", lambda **kwargs: client)
    if proof_kind in ("wrong_hash", "empty", "malformed"):
        with pytest.raises(verifier.VerificationError, match="timestamp proof"):
            verifier.verify_drop("https://fairdrop.example", drop_id)
    else:
        checks = verifier.verify_drop("https://fairdrop.example", drop_id)
        assert checks[-1] == ("round-0 allocation", "PASS")
