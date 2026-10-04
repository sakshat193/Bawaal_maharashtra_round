// Proof-of-work puzzle, fairdrop/pow/v1. Owner: Member 2.
// Must match common/fairdrop_common/pow.py exactly; tests/test_pow_js.py checks both directions.
//
// For sub-puzzle i (0..k-1) find a nonce n (0 <= n < 2^53) such that
//   Argon2id(password = u32be(i) || u64be(n), salt = challenge, t=1, m=memory_kib, p=1, len=32)
// has at least `bits` leading zero bits.
import { argon2id } from 'hash-wasm';

export const MAX_NONCE = 2 ** 53;

export function hexToBytes(hex) {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16);
  return out;
}

export function leadingZeroBits(h) {
  let n = 0;
  for (const b of h) {
    if (b === 0) { n += 8; continue; }
    return n + Math.clz32(b) - 24;
  }
  return n;
}

function password(index, nonce) {
  const p = new Uint8Array(12);
  const v = new DataView(p.buffer);
  v.setUint32(0, index);
  v.setUint32(4, Math.floor(nonce / 2 ** 32));
  v.setUint32(8, nonce >>> 0);
  return p;
}

export function puzzleHash(challenge, index, nonce, memoryKib) {
  return argon2id({
    password: password(index, nonce), salt: challenge,
    parallelism: 1, iterations: 1, memorySize: memoryKib, hashLength: 32, outputType: 'binary',
  });
}

export async function solveOne(challenge, index, bits, memoryKib, isAborted = () => false) {
  for (let n = 0; n < MAX_NONCE; n++) {
    if (isAborted()) throw new DOMException('aborted', 'AbortError');
    if (leadingZeroBits(await puzzleHash(challenge, index, n, memoryKib)) >= bits) return n;
  }
  throw new Error('nonce space exhausted');
}

export async function verify(challenge, nonces, bits, k, memoryKib) {
  if (!Array.isArray(nonces) || nonces.length !== k) return false;
  for (let i = 0; i < k; i++) {
    const n = nonces[i];
    if (!Number.isInteger(n) || n < 0 || n >= MAX_NONCE) return false;
    if (leadingZeroBits(await puzzleHash(challenge, i, n, memoryKib)) < bits) return false;
  }
  return true;
}
