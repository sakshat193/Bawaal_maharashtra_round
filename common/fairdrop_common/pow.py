"""Proof-of-work: Argon2id sub-puzzles bound to (drop, identity, issued_at). Owner: Member 2.

The browser worker in frontend/src/pow/ implements exactly the same puzzle; if you
change anything here, change it there and rerun the round-trip test.

Puzzle (version fairdrop/pow/v1):
  challenge = HMAC-SHA256(pow_key, b"fairdrop/pow/v1\\x00" || drop_id.bytes(16)
                                   || identity_id utf-8 || b"\\x00" || issued_at ascii)
     issued_at is ISO-8601 UTC, whole seconds, ending in Z.
  For sub-puzzle i in 0..k-1 find the smallest-found nonce n (0 <= n < 2**53) with
    h = Argon2id(password = i.to_bytes(4, "big") || n.to_bytes(8, "big"),
                 salt = challenge, t = 1, m = memory_kib, p = 1, len = 32, v = 0x13)
    and at least `bits` leading zero bits in h.
  The proof is the list of k nonces, index i solving sub-puzzle i.

The challenge is stateless: it is recomputed at verification from the entry's own
fields, so a proof cannot be moved to another identity or drop. Expected work is
k * 2**bits Argon2id evaluations; verification is exactly k.
"""
import hashlib
import hmac
import uuid
from dataclasses import dataclass

from argon2.low_level import Type, hash_secret_raw

DOMAIN = b"fairdrop/pow/v1\x00"
TIME_COST = 1
PARALLELISM = 1
HASH_LEN = 32
MAX_NONCE = 2**53  # exclusive; keeps nonces exact as JavaScript numbers


@dataclass(frozen=True)
class PowParams:
    bits: int
    k: int = 16
    memory_kib: int = 2048


def challenge(pow_key: bytes, drop_id: str | uuid.UUID, identity_id: str, issued_at: str) -> bytes:
    did = drop_id if isinstance(drop_id, uuid.UUID) else uuid.UUID(str(drop_id))
    msg = DOMAIN + did.bytes + identity_id.encode("utf-8") + b"\x00" + issued_at.encode("ascii")
    return hmac.new(pow_key, msg, hashlib.sha256).digest()


def _as_bytes(ch: bytes | str) -> bytes:
    return bytes.fromhex(ch) if isinstance(ch, str) else ch


def puzzle_hash(ch: bytes, index: int, nonce: int, memory_kib: int) -> bytes:
    return hash_secret_raw(
        secret=index.to_bytes(4, "big") + nonce.to_bytes(8, "big"),
        salt=ch, time_cost=TIME_COST, memory_cost=memory_kib,
        parallelism=PARALLELISM, hash_len=HASH_LEN, type=Type.ID,
    )


def leading_zero_bits(h: bytes) -> int:
    n = 0
    for byte in h:
        if byte == 0:
            n += 8
            continue
        return n + 8 - byte.bit_length()
    return n


def solve_one(ch: bytes | str, index: int, bits: int, memory_kib: int, start: int = 0) -> int:
    ch = _as_bytes(ch)
    n = start
    while n < MAX_NONCE:
        if leading_zero_bits(puzzle_hash(ch, index, n, memory_kib)) >= bits:
            return n
        n += 1
    raise RuntimeError("nonce space exhausted")


def solve(ch: bytes | str, bits: int, k: int = 16, memory_kib: int = 2048,
          start_index: int = 0, prior: list[int] | None = None) -> list[int]:
    """Solve all k sub-puzzles; resume from start_index with already-found nonces in prior."""
    nonces = list(prior or [])[:start_index]
    for i in range(start_index, k):
        nonces.append(solve_one(ch, i, bits, memory_kib))
    return nonces


def verify(ch: bytes | str, nonces: list[int], bits: int, k: int = 16, memory_kib: int = 2048) -> bool:
    ch = _as_bytes(ch)
    if nonces is None or len(nonces) != k:
        return False
    for i, n in enumerate(nonces):
        if not isinstance(n, int) or not (0 <= n < MAX_NONCE):
            return False
        if leading_zero_bits(puzzle_hash(ch, i, n, memory_kib)) < bits:
            return False
    return True


def verify_entry(pow_key: bytes, drop_id: str, identity_id: str, issued_at: str,
                 nonces: list[int], bits: int, k: int, memory_kib: int) -> bool:
    """Top-level and picklable, so the seal can run it in a process pool."""
    return verify(challenge(pow_key, drop_id, identity_id, issued_at), nonces, bits, k, memory_kib)
