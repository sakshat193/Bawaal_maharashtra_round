import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { act, create } from 'react-test-renderer';
import Verifier from './index.js';
import { canonicalSnapshotBytes, sha256Hex } from './canonical.js';

const dropId = '00000000-0000-0000-0000-000000000001';
const text = node => typeof node === 'string' ? node : Array.isArray(node) ? node.map(text).join('') : node?.children ? text(node.children) : '';

async function verify(t, { mediaType = 'application/x-ndjson', proofChange = {}, malformed = false, promoted = true } = {}) {
  const entries = [{ entry_id: '01'.repeat(16), tier_id: 'main', quantity: 1, accepted_at: '2026-01-01T00:00:00.000000Z' }];
  const exclusions = new Uint8Array();
  const exclusionsHash = await sha256Hex(exclusions);
  const bytes = canonicalSnapshotBytes({ drop_id: dropId, config_hash: '00'.repeat(32), exclusions_hash: exclusionsHash, drand_round: 40000000 }, entries);
  const hash = await sha256Hex(bytes);
  const proof = { snapshot_sha256: hash, ots: { calendars: [{ url: 'https://calendar.example', ots: 'proof' }] }, ...proofChange };
  const headers = { 'content-type': mediaType, 'x-fairdrop-snapshot-sha256': hash, 'x-fairdrop-exclusions-sha256': exclusionsHash,
    'x-fairdrop-timestamped-at': '2026-01-01T00:00:00Z', 'x-fairdrop-timestamp-proof': malformed ? '!!!' : Buffer.from(JSON.stringify(proof)).toString('base64') };
  const oldFetch = globalThis.fetch;
  let root;
  t.after(() => { act(() => root?.unmount()); globalThis.fetch = oldFetch; });
  globalThis.fetch = async url => {
    if (url.endsWith('/snapshot')) return new Response(mediaType.startsWith('application/json') ? JSON.stringify({ canonical_blob: new TextDecoder().decode(bytes) }) : bytes, { headers });
    if (url.endsWith('/exclusions')) return new Response(exclusions, { headers: { ...headers, 'content-type': 'application/x-ndjson' } });
    const value = url.endsWith('/draw') ? { round: 40000000, signature: 'ab', randomness: '00'.repeat(32), ranked_entry_ids: entries.map(e => e.entry_id),
      allocation: [...entries.map(e => ({ ...e, round: 0 })), ...(promoted ? [{ entry_id: '02'.repeat(16), round: 1 }] : [])] }
      : { drand_round: 40000000, allocation_mode: 'fcfs', tiers: [{ tier_id: 'main', capacity: 1 }] };
    return Response.json(value);
  };
  await act(async () => { root = create(React.createElement(Verifier, { dropId })); });
  const deadline = Date.now() + 2000;
  while (text(root.toJSON()).includes('Checking published evidence') && Date.now() < deadline) {
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 5)); });
  }
  return text(root.toJSON());
}

test('verifies NDJSON bytes, Fairdrop headers and only round-0 allocation', async t => {
  assert.match(await verify(t), /PASS/);
});
test('accepts application/json with charset for snapshot wrapper', async t => {
  assert.match(await verify(t, { mediaType: 'application/json; charset=utf-8' }), /PASS/);
});
test('rejects a timestamp proof for another snapshot', async t => {
  assert.match(await verify(t, { proofChange: { snapshot_sha256: 'ff'.repeat(32) } }), /Verification failed/);
});
test('rejects proof metadata without a calendar or Git commit', async t => {
  assert.match(await verify(t, { proofChange: { ots: { calendars: [] } } }), /Verification failed/);
});
test('rejects malformed base64 proof', async t => {
  assert.match(await verify(t, { malformed: true }), /Verification failed/);
});
test('accepts a Git timestamp bound to the snapshot', async t => {
  assert.match(await verify(t, { proofChange: { ots: null, git: { commit: 'abc' } } }), /PASS/);
});
