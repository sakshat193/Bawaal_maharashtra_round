"""Key loading and receipt signatures. Owner: Member 2.

Keys are always loaded from files and never generated here; scripts/gen_keys.py
creates them once.
"""
import base64
import hashlib
from pathlib import Path

from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey, Ed25519PublicKey

from ._compat import canonical


def load_ed25519_private(path: str | Path) -> Ed25519PrivateKey:
    key = serialization.load_pem_private_key(Path(path).read_bytes(), password=None)
    if not isinstance(key, Ed25519PrivateKey):
        raise ValueError(f"{path} is not an Ed25519 private key")
    return key


def load_hmac_key(path: str | Path) -> bytes:
    raw = Path(path).read_bytes().strip()
    key = bytes.fromhex(raw.decode("ascii"))
    if len(key) < 32:
        raise ValueError(f"{path}: HMAC key must be at least 32 bytes")
    return key


def public_raw(key: Ed25519PrivateKey | Ed25519PublicKey) -> bytes:
    pub = key.public_key() if isinstance(key, Ed25519PrivateKey) else key
    return pub.public_bytes(serialization.Encoding.Raw, serialization.PublicFormat.Raw)


def key_id(key: Ed25519PrivateKey | Ed25519PublicKey) -> str:
    """Short stable identifier: first 16 hex chars of SHA-256 of the raw public key."""
    return hashlib.sha256(public_raw(key)).hexdigest()[:16]


def sign_receipt(key: Ed25519PrivateKey, receipt: dict) -> str:
    """base64 Ed25519 signature over the canonical receipt bytes."""
    return base64.b64encode(key.sign(canonical.receipt_bytes(receipt))).decode("ascii")


def verify_receipt(public_key_b64: str, receipt: dict, sig_b64: str) -> bool:
    pub = Ed25519PublicKey.from_public_bytes(base64.b64decode(public_key_b64))
    try:
        pub.verify(base64.b64decode(sig_b64), canonical.receipt_bytes(receipt))
        return True
    except (InvalidSignature, ValueError):
        return False
