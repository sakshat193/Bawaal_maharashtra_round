"""Every JWT rejection case from the plan, plus the happy path."""
import base64
import hashlib
import hmac
import json
import time

import jwt
import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

from app.entry.keys import get_keys
from app.entry.platform import AUDIENCE, ISSUER

from .conftest import login, make_open_drop


def _b64(b: bytes) -> str:
    return base64.urlsafe_b64encode(b).rstrip(b"=").decode()


def _claims(**over):
    now = int(time.time())
    c = {"iss": ISSUER, "aud": AUDIENCE, "sub": "id_test", "identity_id": "id_test", "iat": now,
         "exp": now + 600, "nonce": "n", "account_created_at": "2020-01-01T00:00:00Z",
         "device_hash": "d", "payment_fingerprint": "p"}
    c.update(over)
    return c


def _signed(claims, key=None):
    return jwt.encode(claims, key or get_keys().platform, algorithm="EdDSA")


def _challenge(client, did, token):
    return client.get(f"/api/drops/{did}/pow-challenge", headers={"Authorization": f"Bearer {token}"})


def test_valid_token_accepted(client):
    did = make_open_drop(client)
    assert client.get(f"/api/drops/{did}/pow-challenge", headers=login(client, "alice")).status_code == 200
    assert _challenge(client, did, _signed(_claims())).status_code == 200


def test_alg_none_rejected(client):
    did = make_open_drop(client)
    tok = _b64(json.dumps({"alg": "none", "typ": "JWT"}).encode()) + "." + _b64(json.dumps(_claims()).encode()) + "."
    assert _challenge(client, did, tok).status_code == 401


def test_hs256_signed_with_public_key_rejected(client):
    did = make_open_drop(client)
    pub_pem = get_keys().platform_pub.public_bytes(serialization.Encoding.PEM,
                                                   serialization.PublicFormat.SubjectPublicKeyInfo)
    for secret in (pub_pem, get_keys().platform_pub.public_bytes(serialization.Encoding.Raw,
                                                                 serialization.PublicFormat.Raw)):
        head = _b64(json.dumps({"alg": "HS256", "typ": "JWT"}).encode())
        body = _b64(json.dumps(_claims()).encode())
        sig = _b64(hmac.new(secret, f"{head}.{body}".encode(), hashlib.sha256).digest())
        assert _challenge(client, did, f"{head}.{body}.{sig}").status_code == 401


@pytest.mark.parametrize("over", [
    {"aud": "someone-else"},
    {"iss": "evil-platform"},
    {"iat": int(time.time()) - 900, "exp": int(time.time()) - 60},     # expired
    {"exp": int(time.time()) + 3600},                                   # lifetime > 15 min
    {"iat": int(time.time()) + 600, "exp": int(time.time()) + 900},    # issued in the future
    {"identity_id": "id_other"},                                        # sub mismatch
])
def test_bad_claims_rejected(client, over):
    did = make_open_drop(client)
    r = _challenge(client, did, _signed(_claims(**over)))
    assert r.status_code == 401 and r.json()["error"] == "unauthorized"


@pytest.mark.parametrize("missing", ["exp", "iat", "nonce", "identity_id", "sub"])
def test_missing_required_claim_rejected(client, missing):
    did = make_open_drop(client)
    c = _claims()
    del c[missing]
    assert _challenge(client, did, _signed(c)).status_code == 401


def test_foreign_key_rejected(client):
    did = make_open_drop(client)
    assert _challenge(client, did, _signed(_claims(), Ed25519PrivateKey.generate())).status_code == 401


def test_missing_header_and_garbage_rejected(client):
    did = make_open_drop(client)
    assert client.get(f"/api/drops/{did}/pow-challenge").status_code == 401
    assert _challenge(client, did, "not.a.jwt").status_code == 401
    assert client.get(f"/api/drops/{did}/pow-challenge", headers={"Authorization": "Basic abc"}).status_code == 401


def test_identity_is_stable_and_token_lifetime_capped(client):
    a1 = client.post("/platform/login", json={"username": "alice"}).json()
    a2 = client.post("/platform/login", json={"username": "alice"}).json()
    b = client.post("/platform/login", json={"username": "bob"}).json()
    assert a1["identity_id"] == a2["identity_id"] != b["identity_id"]
    assert a1["identity_id"].startswith("id_") and len(a1["identity_id"]) == 19
    claims = jwt.decode(a1["token"], options={"verify_signature": False})
    assert claims["exp"] - claims["iat"] <= 900
    assert jwt.get_unverified_header(a1["token"])["alg"] == "EdDSA"
