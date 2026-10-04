import uuid

from fairdrop_common import pow as fpow

KEY = b"k" * 32
DROP = uuid.UUID("11111111-2222-3333-4444-555555555555")


def test_solve_verify_roundtrip():
    ch = fpow.challenge(KEY, DROP, "id_alice", "2026-10-04T13:00:05Z")
    nonces = fpow.solve(ch, bits=3, k=4, memory_kib=64)
    assert len(nonces) == 4 and fpow.verify(ch, nonces, 3, 4, 64)
    assert fpow.verify(ch.hex(), nonces, 3, 4, 64)            # hex form, as the API serves it


def test_proof_bound_to_identity_drop_and_time():
    ch = fpow.challenge(KEY, DROP, "id_alice", "2026-10-04T13:00:05Z")
    nonces = fpow.solve(ch, bits=6, k=3, memory_kib=64)
    for other in (fpow.challenge(KEY, DROP, "id_bob", "2026-10-04T13:00:05Z"),
                  fpow.challenge(KEY, uuid.uuid4(), "id_alice", "2026-10-04T13:00:05Z"),
                  fpow.challenge(KEY, DROP, "id_alice", "2026-10-04T13:00:06Z")):
        assert not fpow.verify(other, nonces, 6, 3, 64)


def test_verify_rejects_bad_shapes():
    ch = fpow.challenge(KEY, DROP, "id_a", "2026-10-04T13:00:05Z")
    n = fpow.solve(ch, bits=2, k=2, memory_kib=64)
    assert not fpow.verify(ch, n[:1], 2, 2, 64)
    assert not fpow.verify(ch, n + [0], 2, 2, 64)
    assert not fpow.verify(ch, [-1, n[1]], 2, 2, 64)
    assert not fpow.verify(ch, [fpow.MAX_NONCE, n[1]], 2, 2, 64)
    assert not fpow.verify(ch, None, 2, 2, 64)


def test_resume_from_index():
    ch = fpow.challenge(KEY, DROP, "id_a", "2026-10-04T13:00:05Z")
    full = fpow.solve(ch, bits=3, k=5, memory_kib=64)
    assert fpow.solve(ch, bits=3, k=5, memory_kib=64, start_index=2, prior=full[:2]) == full


def test_leading_zero_bits():
    assert fpow.leading_zero_bits(b"\x00\x00\xff") == 16
    assert fpow.leading_zero_bits(b"\x01") == 7
    assert fpow.leading_zero_bits(b"\x80") == 0
    assert fpow.leading_zero_bits(b"\x00\x10") == 11
