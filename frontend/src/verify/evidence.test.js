import test from 'node:test';
import assert from 'node:assert/strict';
import { readEvidence } from './evidence.js';

test('readEvidence reads snapshot evidence from response headers', () => {
  const headers = new Headers({
    'X-Fairdrop-Snapshot-Sha256': 'snapshot-hash',
    'X-Fairdrop-Exclusions-Sha256': 'exclusions-hash',
    'X-Fairdrop-Sealed-At': '2026-10-04T13:10:00Z',
    'X-Fairdrop-Timestamped-At': '2026-10-04T13:12:00Z'
  });

  assert.deepEqual(readEvidence(headers), {
    snapshotHash: 'snapshot-hash',
    exclusionsHash: 'exclusions-hash',
    sealedAt: '2026-10-04T13:10:00Z',
    timestampedAt: '2026-10-04T13:12:00Z'
  });
});

test('readEvidence explains when the timestamp header is absent', () => {
  const headers = new Headers({
    'X-Fairdrop-Snapshot-Sha256': 'snapshot-hash',
    'X-Fairdrop-Exclusions-Sha256': 'exclusions-hash',
    'X-Fairdrop-Sealed-At': '2026-10-04T13:10:00Z'
  });

  assert.equal(readEvidence(headers).timestampedAt, 'Not timestamped yet');
});
