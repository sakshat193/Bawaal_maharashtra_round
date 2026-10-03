import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { invariantFailures, summarizeMode, sceneCounts, resultsShapeError } from '../../frontend/src/pages/dashboardData.js';
import { loadComponent } from '../../frontend/src/testSupport.js';
import { solvePow } from '../../frontend/src/pow/index.js';

// Acceptance tests: a failure means the release condition is NOT satisfied.
// Upstream checks use fetched refs; fetch before rerunning after teammate fixes.
const upstream = (ref, path) => execFileSync('git', ['show', `${ref}:${path}`], { encoding: 'utf8' });
const fixture = name => JSON.parse(readFileSync(new URL(`../../contracts/fixtures/${name}.json`, import.meta.url)));
const harness = JSON.parse(upstream('origin/bhargavi', 'contracts/fixtures/results.json'));
const require = createRequire(new URL('../../frontend/package.json', import.meta.url));
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const { transformSync } = require('esbuild');
const dashboard = readFileSync(new URL('../../frontend/src/pages/JudgeDashboard.jsx', import.meta.url), 'utf8');
const modesDeclaration = dashboard.match(/const MODES = [\s\S]*?;/)[0];
const validation = dashboard.slice(dashboard.indexOf('function validResults('), dashboard.indexOf('function SeatGrid('));
const validResults = new Function('resultsShapeError', `${modesDeclaration}\n${validation}\nreturn validResults;`)(resultsShapeError);
const panelSource = dashboard.slice(dashboard.indexOf('function InvariantsPanel('), dashboard.indexOf('export default function JudgeDashboard('));
const panelJs = transformSync(panelSource, { loader: 'jsx' }).code;
const InvariantsPanel = new Function('React', 'invariantFailures', 'messageForError', `${panelJs}\nreturn InvariantsPanel;`)(React, invariantFailures, () => 'API unavailable');

test('G2: draw fixture exposes M3 ranking, draw time and offer identifiers', () => {
  const draw = fixture('getDraw.200');
  assert.ok(Array.isArray(draw.ranked_entry_ids), 'ranked_entry_ids missing');
  assert.ok(Number.isFinite(Date.parse(draw.drawn_at)), 'drawn_at missing');
  assert.ok(draw.allocation.every(row => row.round === 0 && typeof row.offer_id === 'string'));
});

test('G2: dashboard accepts a valid M3 invariant payload', () => {
  assert.deepEqual(invariantFailures({
    tiers: [{ tier_id: 'gold', held: 2, active_offer_units: 2, capacity: 3 }],
    oversell: 0, held_mismatch: 0, double_redemption: 0
  }), []);
});

test('G3: incomplete or corrupt invariant evidence never reports all clear', () => {
  // Updated acceptance: missing tiers means unavailable (null), per Stage 2.
  assert.equal(invariantFailures({ entries_with_multiple_offers: 0 }), null);
  const cases = [
    { tiers: [{ tier_id: 'gold', held: -1, active_offer_units: -1, capacity: 3 }], oversell: 0, held_mismatch: 0, double_redemption: 0 },
    { tiers: [{ tier_id: 'gold', held: 2, active_offer_units: 2, capacity: 3 }], oversell: 1, held_mismatch: 1, double_redemption: 1 }
  ];
  for (const value of cases) {
    assert.ok(invariantFailures(value)?.length > 0, `false green: ${JSON.stringify(value)}`);
  }
});

test('G2: live invariant rows are renderable using current dashboard field', () => {
  const invariants = { tiers: [{ tier_id: 'gold', held: 2, active_offer_units: 2, capacity: 3 }], oversell: 0, held_mismatch: 0, double_redemption: 0 };
  assert.doesNotThrow(() => renderToStaticMarkup(React.createElement(InvariantsPanel, { invariants })));
});

test('G4: harness lottery totals survive dashboard summarization', () => {
  const mode = harness.modes.find(item => item.mode === 'lottery_wil');
  assert.equal(summarizeMode(mode).tickets, mode.tickets_won);
  assert.equal(summarizeMode(mode).botTicketShare, mode.bot_ticket_share);
  assert.equal(sceneCounts(mode).seats, mode.tickets_won);
});

test('G4: published harness modes satisfy the current dashboard acceptance predicate', () => {
  assert.ok(validResults(harness), 'real results.json is rejected and replaced with the fixture');
});

test('G5: current solvePow produces a proof accepted by M2 verification', async () => {
  const params = { ...fixture('getPowChallenge.200'), k: 1, bits: 8, memory_kib: 32 };
  const nonces = await solvePow(params);
  const result = execFileSync('python', ['-c',
    'import json,sys; x=json.load(sys.stdin); ns={"__name__":"audit_pow"}; exec(x["source"],ns); p=x["params"]; print(ns["verify"](p["challenge"],x["nonces"],p["bits"],p["k"],p["memory_kib"]))'
  ], { encoding: 'utf8', input: JSON.stringify({
    params, nonces, source: upstream('origin/jash', 'common/fairdrop_common/pow.py')
  }) }).trim();
  assert.equal(result, 'True', `M2 rejects nonces ${JSON.stringify(nonces)}`);
});

test('G7: verifier rejects tampered snapshot bytes with unchanged published headers', async () => {
  const { act, create } = require('react-test-renderer');
  const { default: Verifier } = await loadComponent('./verify/index.jsx');
  const oldFetch = globalThis.fetch;
  const headers = fixture('getSnapshot.200.headers');
  globalThis.fetch = async () => new Response('{"tampered":true}\n', {
    headers: { ...headers, 'Content-Type': 'application/x-ndjson' }
  });
  let root;
  try {
    await act(async () => { root = create(React.createElement(Verifier, { dropId: fixture('getDrop.200').drop_id })); });
    assert.ok(root.root.findAll(node => node.props.role === 'alert').length > 0,
      'current verifier displays hash headers without checking snapshot bytes');
  } finally {
    act(() => root?.unmount());
    globalThis.fetch = oldFetch;
  }
});
