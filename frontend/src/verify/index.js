import { createElement as h, useEffect, useState } from 'react';
import { canonicalExclusionsBytes, parseExclusions, parseSnapshot, sha256Hex } from './canonical.js';
import { fcfsOrder, initialAllocation, lotteryOrder } from './rank.js';

const labelStyle = { fontSize: 11, letterSpacing: '0.14em', textTransform: 'uppercase', color: '#8A8A9A' };
const QUICKNET_GENESIS = 1692803367;
const QUICKNET_PERIOD = 3;

async function jsonResponse(url, signal) {
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  return response.json();
}

async function artifact(url, names, signal, exclusions = false) {
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  const metadata = Object.fromEntries(response.headers.entries());
  if (!response.headers.get('content-type')?.includes('json')) {
    return { bytes: new Uint8Array(await response.arrayBuffer()), metadata };
  }
  const value = await response.json();
  Object.assign(metadata, value);
  for (const key of ['snapshot', 'exclusions', 'data']) {
    if (value[key] && typeof value[key] === 'object' && !Array.isArray(value[key])) Object.assign(metadata, value[key]);
  }
  for (const name of names) {
    const blob = metadata[name] ?? value[name];
    if (typeof blob === 'string') {
      if (metadata.encoding === 'base64') {
        const binary = atob(blob);
        return { bytes: Uint8Array.from(binary, char => char.charCodeAt(0)), metadata };
      }
      return { bytes: new TextEncoder().encode(blob), metadata };
    }
    if (Array.isArray(blob) && exclusions) return { bytes: canonicalExclusionsBytes(blob), metadata };
  }
  for (const name of ['canonical_blob_base64', 'snapshot_base64', 'exclusions_base64', 'blob_base64']) {
    if (typeof value[name] === 'string') {
      const binary = atob(value[name]);
      return { bytes: Uint8Array.from(binary, char => char.charCodeAt(0)), metadata };
    }
  }
  throw new Error(`${url}: canonical bytes are missing`);
}

function published(metadata, ...names) {
  const normalized = Object.fromEntries(Object.entries(metadata).map(([key, value]) => [key.toLowerCase(), value]));
  for (const name of names) {
    const value = metadata[name] ?? normalized[name.toLowerCase()];
    if (value != null && value !== '') return value;
  }
  return null;
}

function evidenceRows(draw) {
  let rows = draw.round_0_allocation ?? draw.initial_allocation ?? draw.allocation ?? draw.offers;
  if (rows && !Array.isArray(rows)) rows = rows.offers ?? rows.entries ?? rows.allocated ?? Object.entries(rows).flatMap(([tier_id, ids]) =>
    Array.isArray(ids) ? ids.map(entry_id => ({ entry_id, tier_id })) : []);
  return Array.isArray(rows) ? rows : null;
}

function allocationRows(rows, entries) {
  const byId = new Map(entries.map(row => [row.entry_id, row]));
  return rows.map(item => {
    const id = typeof item === 'string' ? item : item.entry_id;
    const source = byId.get(id);
    if (!source) throw new Error(`Draw contains unknown allocation ${id}`);
    return { entry_id: id, tier_id: item.tier_id ?? source.tier_id, quantity: item.quantity ?? source.quantity };
  }).sort((a, b) => a.entry_id < b.entry_id ? -1 : a.entry_id > b.entry_id ? 1 : 0);
}

async function verifyDrop(dropId, signal) {
  const path = `/api/drops/${encodeURIComponent(dropId)}`;
  const [drop, snapshotArtifact, exclusionsArtifact, draw] = await Promise.all([
    jsonResponse(path, signal),
    artifact(`${path}/snapshot`, ['canonical_blob', 'snapshot_blob', 'snapshot', 'blob'], signal),
    artifact(`${path}/exclusions`, ['exclusions_blob', 'canonical_blob', 'blob', 'exclusions'], signal, true),
    jsonResponse(`${path}/draw`, signal),
  ]);
  const { header, entries } = parseSnapshot(snapshotArtifact.bytes);
  if (header.drop_id !== dropId) throw new Error('Snapshot belongs to a different drop');
  const exclusions = parseExclusions(exclusionsArtifact.bytes);
  const eligibleIds = new Set(entries.map(row => row.entry_id));
  if (exclusions.some(row => eligibleIds.has(row.entry_id))) throw new Error('An entry appears in both the snapshot and exclusions');
  const snapshotHash = await sha256Hex(snapshotArtifact.bytes);
  const exclusionsHash = await sha256Hex(exclusionsArtifact.bytes);
  const expectedSnapshot = published(snapshotArtifact.metadata, 'canonical_hash', 'snapshot_hash', 'x-snapshot-hash', 'x-canonical-hash') ?? draw.snapshot_hash ?? draw.canonical_hash;
  const expectedExclusions = published(exclusionsArtifact.metadata, 'exclusions_hash', 'x-exclusions-hash') ?? draw.exclusions_hash ?? header.exclusions_hash;
  let timestampProof = published(snapshotArtifact.metadata, 'timestamp_proof', 'x-timestamp-proof');
  if (typeof timestampProof === 'string') {
    try { timestampProof = JSON.parse(timestampProof); } catch { /* The raw proof string is still evidence. */ }
  }
  const timestampedAt = published(snapshotArtifact.metadata, 'timestamped_at', 'x-timestamped-at') ?? timestampProof?.timestamped_at;
  const proofPresent = typeof timestampProof === 'string'
    ? Boolean(timestampProof.trim())
    : ['ots_receipt', 'ots_proof', 'opentimestamps', 'public_commit_url', 'commit_url', 'proof'].some(key => timestampProof?.[key]);
  if (!expectedSnapshot || snapshotHash !== String(expectedSnapshot).trim().toLowerCase()) throw new Error('Snapshot hash differs from its published hash');
  if (!expectedExclusions || exclusionsHash !== String(expectedExclusions).trim().toLowerCase()) throw new Error('Exclusions hash differs from its published hash');
  if (header.exclusions_hash !== exclusionsHash) throw new Error('Snapshot header does not commit to the exclusions hash');
  if (!proofPresent || !timestampedAt) throw new Error('Timestamp proof metadata is missing');
  const round = Number(header.drand_round);
  if (Number(drop.drand_round ?? round) !== round || Number(draw.drand_round ?? draw.round ?? round) !== round) throw new Error('Drop, snapshot, and draw disagree on round R');
  const proofTime = Date.parse(timestampedAt);
  const dueTime = (QUICKNET_GENESIS + (round - 1) * QUICKNET_PERIOD) * 1000;
  if (!Number.isFinite(proofTime) || proofTime >= dueTime) throw new Error('Timestamp proof is not before round R');
  if (draw.signature == null || draw.randomness == null) throw new Error('Draw evidence is missing drand randomness');
  const order = drop.allocation_mode === 'fcfs'
    ? fcfsOrder(entries)
    : drop.allocation_mode === 'lottery_wil'
      ? await lotteryOrder(entries, dropId, draw.randomness)
      : null;
  if (!order) throw new Error(`Unknown allocation mode: ${drop.allocation_mode}`);
  const publishedRank = draw.ranked_entry_ids ?? draw.ranked_entries;
  if (!Array.isArray(publishedRank) || publishedRank.map(row => typeof row === 'string' ? row : row.entry_id).join() !== order.map(row => row.entry_id).join()) {
    throw new Error('Recomputed ranking differs from /draw');
  }
  const allocated = evidenceRows(draw);
  if (!allocated) throw new Error('Draw evidence is missing its round-0 allocation');
  const expectedAllocation = initialAllocation(order, drop.tiers).sort((a, b) => a.entry_id < b.entry_id ? -1 : a.entry_id > b.entry_id ? 1 : 0);
  if (JSON.stringify(allocationRows(allocated, entries)) !== JSON.stringify(expectedAllocation)) throw new Error('Recomputed round-0 allocation differs from /draw');
  return [
    ['Snapshot SHA-256', snapshotHash],
    ['Exclusions SHA-256', `${exclusionsHash} · ${exclusions.length} exclusions`],
    ['Timestamp proof', `${timestampedAt} · before round ${round}`],
    ['Drand round', `${round} · ${draw.randomness}`],
    ['Ranking', `${order.length} eligible entries match /draw`],
    ['Initial allocation', `${expectedAllocation.length} round-0 offers match /draw`],
  ];
}

export default function Verifier({ dropId }) {
  const [state, setState] = useState({ status: 'loading', rows: [], error: '' });
  useEffect(() => {
    const controller = new AbortController();
    if (!dropId) {
      setState({ status: 'error', rows: [], error: 'Choose a drop to verify.' });
      return () => controller.abort();
    }
    setState({ status: 'loading', rows: [], error: '' });
    verifyDrop(dropId, controller.signal)
      .then(rows => setState({ status: 'pass', rows, error: '' }))
      .catch(error => {
        if (error.name !== 'AbortError') setState({ status: 'fail', rows: [], error: error.message });
      });
    return () => controller.abort();
  }, [dropId]);

  const color = state.status === 'pass' ? '#67E8F9' : state.status === 'fail' || state.status === 'error' ? '#FBBF24' : '#C4B5FD';
  return h('section', { style: { background: '#0A0A0F', color: '#ECEBF3', padding: 24, fontFamily: "'JetBrains Mono', monospace", border: '1px solid rgba(255,255,255,0.1)' }, 'aria-live': 'polite' },
    h('div', { style: { ...labelStyle, color } }, state.status === 'pass' ? 'PASS · independently recomputed' : state.status === 'loading' ? 'Checking published evidence…' : 'Verification failed'),
    state.error ? h('p', { role: 'alert', style: { color: '#FBBF24', lineHeight: 1.6 } }, state.error) : null,
    state.rows.length ? h('dl', { style: { display: 'grid', gridTemplateColumns: 'minmax(130px, 220px) 1fr', gap: '10px 18px', marginTop: 20, fontSize: 12, lineHeight: 1.6 } },
      state.rows.flatMap(([label, value]) => [
        h('dt', { key: `${label}-label`, style: labelStyle }, label),
        h('dd', { key: `${label}-value`, style: { margin: 0, overflowWrap: 'anywhere' } }, value),
      ])) : null,
  );
}

