"""Server keys, loaded once from files (see scripts/gen_keys.py)."""
from dataclasses import dataclass
from functools import lru_cache

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey, Ed25519PublicKey

from fairdrop_common import crypto

from ..config import get_settings


@dataclass(frozen=True)
class Keyring:
    platform: Ed25519PrivateKey
    platform_pub: Ed25519PublicKey
    platform_hmac: bytes          # raw private bytes, used to derive stable identity_ids
    receipt: Ed25519PrivateKey
    pow_hmac: bytes


@lru_cache
def get_keys() -> Keyring:
    s = get_settings()
    platform = crypto.load_ed25519_private(s.platform_key_file)
    return Keyring(
        platform=platform,
        platform_pub=platform.public_key(),
        platform_hmac=platform.private_bytes(serialization.Encoding.Raw, serialization.PrivateFormat.Raw,
                                             serialization.NoEncryption()),
        receipt=crypto.load_ed25519_private(s.receipt_key_file),
        pow_hmac=crypto.load_hmac_key(s.pow_key_file),
    )
