import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { buildFixtures } from './gen.mjs';

const fixtureDirectory = new URL('.', import.meta.url);
const fixture = name => JSON.parse(readFileSync(new URL(name, import.meta.url), 'utf8'));
const body = name => readFileSync(new URL(name, import.meta.url), 'utf8');
const hash = value => createHash('sha256').update(value).digest('hex');

test('drop fixtures follow the detail contract and keep the round-zero draw full', () => {
  const open = fixture('./getDrop.200.json');
  const scheduled = fixture('./getDrop.200.scheduled.json');
  const sealed = fixture('./getDrop.200.sealed.json');
  const drawn = fixture('./getDrop.200.drawn.json');
  const settled = fixture('./getDrop.200.settled.json');
  const draw = fixture('./getDraw.200.json');
  const drawnInvariants = fixture('./getInvariants.200.drawn.json');
  const phaseTimes = {
    scheduled: scheduled.server_time,
    open: open.server_time,
    sealed: sealed.server_time,
    drawn: drawn.server_time,
    settled: settled.server_time
  };
  const expectedTiers = [
    ['gold', 'Gold', 450000, 300],
    ['silver', 'Silver', 250000, 900],
    ['bronze', 'Bronze', 120000, 1800]
  ];

  assert.equal(open.name, 'Fair Drop Live');
  assert.equal(open.venue, 'NSCI Dome, Mumbai');
  assert.equal(open.counts.entries, 9000);
  assert.equal(open.counts.eligible, null);
  assert.equal(open.counts.excluded, null);
  assert.equal(open.entry_count, undefined);
  assert.equal(open.drand_round_due_at, '2026-10-04T13:12:30Z');
  assert.equal(open.snapshot, null);
  assert.ok(Date.parse(scheduled.server_time) < Date.parse(scheduled.opens_at));
  assert.ok(Date.parse(open.server_time) < Date.parse(open.closes_at));
  assert.ok(Date.parse(sealed.server_time) > Date.parse(sealed.closes_at));
  assert.ok(Date.parse(drawn.server_time) > Date.parse(drawn.drand_round_due_at));
  assert.ok(Date.parse(settled.server_time) > Date.parse(drawn.server_time));
  assert.deepEqual(open.tiers.map(({ tier_id, name, price_paise, capacity }) => [tier_id, name, price_paise, capacity]), expectedTiers);
  for (const tier of open.tiers) {
    assert.deepEqual(Object.keys(tier).sort(), ['capacity', 'name', 'price_paise', 'tier_id']);
  }

  assert.deepEqual(sealed.counts, { entries: 9000, eligible: 8975, excluded: 25 });
  assert.deepEqual(Object.keys(sealed.snapshot).sort(), ['canonical_hash', 'exclusions_hash', 'sealed_at', 'timestamped_at']);
  assert.equal(sealed.snapshot.timestamped_at, '2026-10-04T13:12:00Z');

  const dropFiles = readdirSync(fixtureDirectory).filter(file => /^getDrop\.\d+.*\.json$/.test(file));
  assert.equal(dropFiles.length, 6);
  for (const file of dropFiles) {
    const drop = fixture(`./${file}`);
    assert.deepEqual(drop.tiers.map(({ tier_id, name, price_paise, capacity }) => [tier_id, name, price_paise, capacity]), expectedTiers);
    assert.ok(drop.tiers.every(tier => Object.keys(tier).sort().join(',') === 'capacity,name,price_paise,tier_id'));
  }

  for (const file of readdirSync(fixtureDirectory).filter(file => /^getMe\.\d+.*\.json$/.test(file))) {
    const me = fixture(`./${file}`);
    assert.equal(me.server_time, phaseTimes[me.phase], `${file} uses its phase time`);
  }
  for (const [file, phase] of [
    ['getInvariants.200.json', 'open'],
    ['getInvariants.200.open.json', 'open'],
    ['getInvariants.200.drawn.json', 'drawn'],
    ['getInvariants.200.settled.json', 'settled']
  ]) {
    assert.equal(fixture(`./${file}`).server_time, phaseTimes[phase], `${file} uses its phase time`);
  }

  assert.equal(draw.ranked.length, 8975);
  assert.equal(draw.ranked.includes('9f2c4a7e1b3d5f60718293a4b5c6d7e8'), true);
  for (const tier of drawn.tiers) {
    const invariant = drawnInvariants.tiers.find(item => item.tier_id === tier.tier_id);
    const allocated = draw.allocation
      .filter(item => item.tier_id === tier.tier_id)
      .reduce((sum, item) => sum + item.quantity, 0);
    assert.equal(invariant.held, allocated);
    assert.equal(invariant.held, tier.capacity);
    assert.equal(invariant.general_sale_units, 0);
  }
});

test('offered /me keeps the exact offer keys and viewer terms', () => {
  const { entry, offer } = fixture('./getMe.200.offered.json');

  assert.deepEqual(Object.keys(offer).sort(), [
    'offer_id', 'tier_id', 'quantity', 'amount_paise', 'round', 'status', 'expires_at', 'pay_deadline'
  ].sort());
  assert.equal(entry.tier_id, 'gold');
  assert.equal(entry.quantity, 2);
  assert.equal(entry.rank, 184);
  assert.equal(offer.tier_id, 'gold');
  assert.equal(offer.quantity, 2);
  assert.equal(offer.amount_paise, 900000);
});

test('settled inventory balances while silver and bronze remain partial', () => {
  const settled = fixture('./getDrop.200.settled.json');
  const invariants = fixture('./getInvariants.200.settled.json');
  const draw = fixture('./getDraw.200.json');
  const outcomes = fixture('./adminOutcomes.200.json').outcomes;
  const tierByEntry = new Map(draw.allocation.map(item => [item.entry_id, item.tier_id]));
  const active = new Map(settled.tiers.map(tier => [tier.tier_id, 0]));
  const activeStatuses = new Set(['offered', 'payment_pending', 'confirmed']);
  const expected = [
    ['gold', 300, 0],
    ['silver', 840, 60],
    ['bronze', 1620, 180]
  ];

  for (const outcome of outcomes) {
    if (activeStatuses.has(outcome.status)) {
      const tierId = tierByEntry.get(outcome.entry_id);
      active.set(tierId, active.get(tierId) + outcome.quantity);
    }
  }

  assert.deepEqual(settled.tiers.map(tier => {
    const invariant = invariants.tiers.find(item => item.tier_id === tier.tier_id);
    return [tier.tier_id, invariant.held, invariant.general_sale_units];
  }), expected);

  for (const tier of settled.tiers) {
    const invariant = invariants.tiers.find(item => item.tier_id === tier.tier_id);
    assert.equal(invariant.held + invariant.general_sale_units, tier.capacity);
    assert.equal(invariant.held, invariant.active_quantity);
    assert.equal(active.get(tier.tier_id), invariant.held);
  }
  assert.ok(invariants.tiers.find(tier => tier.tier_id === 'silver').held < settled.tiers.find(tier => tier.tier_id === 'silver').capacity);
  assert.ok(invariants.tiers.find(tier => tier.tier_id === 'bronze').held < settled.tiers.find(tier => tier.tier_id === 'bronze').capacity);
});

test('snapshot and exclusions are NDJSON with matching evidence headers', () => {
  const snapshot = body('./getSnapshot.200.ndjson');
  const exclusions = body('./getExclusions.200.ndjson');
  const snapshotHeaders = fixture('./getSnapshot.200.headers.json');
  const exclusionsHeaders = fixture('./getExclusions.200.headers.json');
  const expectedHeaders = [
    'X-Fairdrop-Exclusions-Sha256',
    'X-Fairdrop-Sealed-At',
    'X-Fairdrop-Snapshot-Sha256',
    'X-Fairdrop-Timestamp-Proof',
    'X-Fairdrop-Timestamped-At'
  ];

  assert.ok(snapshot.endsWith('\n'));
  assert.ok(exclusions.endsWith('\n'));
  assert.equal(snapshot.trimEnd().split('\n').every(line => JSON.parse(line)), true);
  assert.equal(exclusions.trimEnd().split('\n').every(line => JSON.parse(line)), true);
  assert.deepEqual(Object.keys(snapshotHeaders).sort(), expectedHeaders);
  assert.deepEqual(Object.keys(exclusionsHeaders).sort(), expectedHeaders);
  assert.equal(snapshotHeaders['X-Fairdrop-Snapshot-Sha256'], hash(snapshot));
  assert.equal(snapshotHeaders['X-Fairdrop-Exclusions-Sha256'], hash(exclusions));
  assert.deepEqual(exclusionsHeaders, snapshotHeaders);

  const sealed = fixture('./getDrop.200.sealed.json');
  assert.equal(snapshotHeaders['X-Fairdrop-Sealed-At'], sealed.snapshot.sealed_at);
  assert.equal(snapshotHeaders['X-Fairdrop-Timestamped-At'], sealed.snapshot.timestamped_at);
  assert.equal(snapshotHeaders['X-Fairdrop-Snapshot-Sha256'], sealed.snapshot.canonical_hash);
  assert.equal(snapshotHeaders['X-Fairdrop-Exclusions-Sha256'], sealed.snapshot.exclusions_hash);
});

test('receipt and snapshot accepted_at values use six fractional digits', () => {
  const snapshotEntries = body('./getSnapshot.200.ndjson')
    .trimEnd()
    .split('\n')
    .slice(1)
    .map(line => JSON.parse(line));
  const receipt = fixture('./createEntry.201.json').receipt;

  assert.ok(snapshotEntries.every(entry => /\.\d{6}Z$/.test(entry.accepted_at)));
  assert.match(receipt.accepted_at, /\.\d{6}Z$/);
});

test('getKeys uses the receipt key envelope from OpenAPI', () => {
  const keys = fixture('./getKeys.200.json');
  assert.deepEqual(Object.keys(keys), ['receipt']);
  assert.deepEqual(Object.keys(keys.receipt).sort(), ['alg', 'kid', 'public_key']);
  assert.equal(keys.receipt.alg, 'Ed25519');
  assert.ok(keys.receipt.public_key);
  assert.equal(Buffer.from(keys.receipt.public_key, 'base64').length, 32);
  assert.ok(keys.receipt.kid);
});

test('fixture errors expose every agreed code and refund late payments', () => {
  const expected = [
    'createEntry.409.entry_exists_different_terms.json',
    'createEntry.403.window_closed.json',
    'createEntry.400.turnstile_failed.json',
    'createEntry.400.unknown_tier.json',
    'createEntry.400.quantity_exceeds_max.json',
    'createEntry.400.invalid_request.json',
    'getMe.401.unauthorized.json',
    'redeemOffer.403.offer_not_yours.json',
    'redeemOffer.409.offer_expired.json',
    'redeemOffer.409.already_redeemed_other_order.json',
    'redeemOffer.409.not_offered.json',
    'payOffer.409.payment_window_closed.json',
    'payOffer.409.not_payment_pending.json'
  ];
  for (const file of expected) assert.ok(fixture(`./${file}`).error, `${file} has an error code`);
  assert.equal(fixture('./payOffer.409.payment_window_closed.json').refund, true);
});

test('fixture output files exactly match deterministic generator output', () => {
  const generated = buildFixtures();
  const actualFiles = readdirSync(fixtureDirectory)
    .filter(file => /\.(json|ndjson)$/.test(file))
    .sort();
  assert.deepEqual(actualFiles, Object.keys(generated).sort());
  for (const [name, value] of Object.entries(generated)) {
    const onDisk = name.endsWith('.ndjson') ? body(`./${name}`) : fixture(`./${name}`);
    assert.deepEqual(onDisk, value, `${name} matches gen.mjs`);
  }
});
