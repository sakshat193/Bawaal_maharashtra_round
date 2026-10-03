"""Create the three server keys ONCE. Existing keys are never overwritten.

  platform_ed25519.pem  mock platform's JWT signing key
  receipt_ed25519.pem   entry receipt signing key (public half served at /api/keys)
  pow_hmac.key          HMAC key for proof-of-work challenges (64 hex chars)

Usage: python scripts/gen_keys.py [--dir keys]
"""
import argparse
import os
import secrets
from pathlib import Path

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey


def _write_new(path: Path, data: bytes) -> None:
    if path.exists():
        print(f"keep     {path}")
        return
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, "wb") as f:
        f.write(data)
    print(f"created  {path}")


def _ed25519_pem() -> bytes:
    return Ed25519PrivateKey.generate().private_bytes(
        serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption())


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dir", default=str(Path(__file__).resolve().parents[1] / "keys"))
    d = Path(ap.parse_args().dir)
    d.mkdir(parents=True, exist_ok=True)
    _write_new(d / "platform_ed25519.pem", _ed25519_pem())
    _write_new(d / "receipt_ed25519.pem", _ed25519_pem())
    _write_new(d / "pow_hmac.key", secrets.token_hex(32).encode("ascii") + b"\n")


if __name__ == "__main__":
    main()
