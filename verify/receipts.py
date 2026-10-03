"""Receipt signature and snapshot membership checks."""

from __future__ import annotations

import base64
import json
from pathlib import Path
from urllib.parse import urljoin

import httpx

from fairdrop_common.canonical import receipt_bytes


def verify_receipt(client: httpx.Client, base_url: str, drop_id: str, path: Path, known_ids: set[str]):
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise ValueError(f"could not read receipt file: {exc}") from exc
    if not isinstance(value, dict):
        raise ValueError("receipt file must contain a JSON object")
    receipt = value.get("receipt", value)
    signature = value.get("receipt_sig", value.get("signature"))
    if not isinstance(receipt, dict) or not isinstance(signature, str):
        raise ValueError("receipt file must contain receipt and receipt_sig")
    if receipt.get("drop_id") != drop_id:
        raise ValueError("receipt belongs to a different drop")
    if receipt.get("entry_id") not in known_ids:
        raise ValueError("receipt entry is absent from both the snapshot and exclusions")

    response = client.get(urljoin(base_url.rstrip("/") + "/", "api/keys"))
    response.raise_for_status()
    keys = response.json()
    if not isinstance(keys, dict):
        raise ValueError("/api/keys did not return a JSON object")
    key_value = next((keys.get(name) for name in (
        "receipt_public_key_pem", "receipt_ed25519_public_key", "receipt_public_key", "receipt"
    ) if keys.get(name)), None)
    if isinstance(key_value, dict):
        key_value = key_value.get("public_key") or key_value.get("pem") or key_value.get("key")
    if not isinstance(key_value, str):
        raise ValueError("/api/keys did not provide the receipt public key")
    try:
        signature_bytes = base64.b64decode(signature, altchars=b"-_", validate=True)
        if key_value.startswith("-----BEGIN"):
            from cryptography.hazmat.primitives import serialization
            public_key = serialization.load_pem_public_key(key_value.encode())
        else:
            encoded_key = base64.b64decode(key_value, altchars=b"-_", validate=True)
            if len(encoded_key) == 32:
                from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey
                public_key = Ed25519PublicKey.from_public_bytes(encoded_key)
            else:
                from cryptography.hazmat.primitives import serialization
                public_key = serialization.load_der_public_key(encoded_key)
        public_key.verify(signature_bytes, receipt_bytes(receipt))
    except Exception as exc:
        raise ValueError(f"receipt signature is invalid: {exc}") from exc

