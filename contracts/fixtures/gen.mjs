import { createHash } from 'node:crypto';
import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const WORLD = {
  drop_id: '6f1c2b9e-3d4a-4e8b-9a71-0c5d2e7f8a13',
  name: 'Fair Drop Live',
  venue: 'NSCI Dome, Mumbai',
  starts_at: '2026-10-04T14:00:00Z',
  opens_at: '2026-10-04T13:00:00Z',
  closes_at: '2026-10-04T13:10:00Z',
  allocation_mode: 'lottery_wil',
  pow_required: true,
  turnstile_required: true,
  pow_bits: 16,
  pow_k: 16,
  pow_memory_kib: 2048,
  max_quantity: 4,
  offer_ttl_s: 600,
  pay_deadline_s: 300,
  max_promotion_rounds: 6,
  sybil_rules: [
    { id: 'device', kind: 'max_per_device', limit: 2 },
    { id: 'payment', kind: 'max_per_payment', limit: 2 },
    { id: 'fresh', kind: 'min_account_age_s', value: 86400 }
  ],
  drand_chain: '52db9ba70e0cc0f6eaf7803dd07447a1f5477735fd3f661792ba94600c84e971',
  drand_round: 32772062,
  drand_round_due_at: '2026-10-04T13:12:30Z',
  tiers: [
    { tier_id: 'gold', name: 'Gold', price_paise: 450000, capacity: 300 },
    { tier_id: 'silver', name: 'Silver', price_paise: 250000, capacity: 900 },
    { tier_id: 'bronze', name: 'Bronze', price_paise: 120000, capacity: 1800 }
  ],
  settled_held: { gold: 300, silver: 840, bronze: 1620 },
  entry_count: 9000,
  exclusions: { device: 12, payment: 4, fresh: 9 },
  viewer: {
    entry_id: '9f2c4a7e1b3d5f60718293a4b5c6d7e8',
    identity_id: 'id_4f9a2c7e1b3d5f60',
    offer_id: '3b8e2c1a-5d4f-4a6b-8c9d-0e1f2a3b4c5d',
    rank: 184,
    tier_id: 'gold',
    quantity: 2,
    accepted_at: '2026-10-04T13:00:06.412000Z'
  },
  server_time: '2026-10-04T13:05:00Z',
};

const PHASE_SERVER_TIME = {
  scheduled: '2026-10-04T12:55:00Z',
  open: WORLD.server_time,
  sealed: '2026-10-04T13:11:00Z',
  drawn: '2026-10-04T13:13:00Z',
  settled: '2026-10-04T13:30:00Z'
};

const canonicalJson = value => {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
};
const sha256 = value => createHash('sha256').update(value).digest('hex');
const idFor = n => n.toString(16).padStart(32, '0');
const isoTimestamp = value => value.toISOString().replace(/\.(\d{3})Z$/, (_, milliseconds) => `.${milliseconds}000Z`);

function random(seed) {
  let value = seed >>> 0;
  return () => {
    value = (Math.imul(value, 1664525) + 1013904223) >>> 0;
    return value / 0x100000000;
  };
}

function buildEntries() {
  const eligibleCount = WORLD.entry_count - Object.values(WORLD.exclusions).reduce((a, b) => a + b, 0);
  const rand = random(0x6f1c2b9e);
  const entries = Array.from({ length: eligibleCount }, (_, index) => {
    const draw = rand();
    const tier_id = draw < 0.1 ? 'gold' : draw < 0.4 ? 'silver' : 'bronze';
    return {
      entry_id: idFor(index + 1),
      identity_id: `id_${idFor(index + 10001).slice(-16)}`,
      tier_id,
      quantity: 1 + Math.floor(rand() * WORLD.max_quantity),
      accepted_at: isoTimestamp(new Date(Date.parse(WORLD.opens_at) + (index % 300) * 1000))
    };
  });

  const viewer = entries.find(entry => entry.entry_id === WORLD.viewer.entry_id);
  if (viewer) throw new Error('viewer id unexpectedly overlaps generated entries');
  entries[WORLD.viewer.rank - 1] = { ...entries[WORLD.viewer.rank - 1], ...WORLD.viewer };

  const shuffle = random(0x32772062);
  for (let i = entries.length - 1; i > 0; i--) {
    const j = Math.floor(shuffle() * (i + 1));
    [entries[i], entries[j]] = [entries[j], entries[i]];
  }
  const oldViewerIndex = entries.findIndex(entry => entry.entry_id === WORLD.viewer.entry_id);
  [entries[oldViewerIndex], entries[WORLD.viewer.rank - 1]] = [entries[WORLD.viewer.rank - 1], entries[oldViewerIndex]];
  return entries;
}

function buildExclusions() {
  return Object.entries(WORLD.exclusions).flatMap(([rule, count], ruleIndex) =>
    Array.from({ length: count }, (_, index) => ({
      entry_id: `f${String(ruleIndex + 1).padStart(1, '0')}${String(index + 1).padStart(30, '0')}`,
      reason: `sybil:${rule}`
    }))
  ).sort((a, b) => a.entry_id.localeCompare(b.entry_id));
}

function buildFixtures() {
  const rankedEntries = buildEntries();
  const ranked = rankedEntries.map(entry => entry.entry_id);
  const exclusions = buildExclusions();
  const exclusionsBlob = exclusions.map(canonicalJson).join('\n') + '\n';
  const exclusionsHash = sha256(exclusionsBlob);
  const config = { ...WORLD };
  delete config.phase;
  delete config.config_hash;
  delete config.server_time;
  delete config.entry_count;
  delete config.exclusions;
  delete config.viewer;
  delete config.drand_round_due_at;
  delete config.settled_held;
  config.tiers = WORLD.tiers.map(({ tier_id, name, price_paise, capacity }) => ({ tier_id, name, price_paise, capacity }))
    .sort((a, b) => a.tier_id.localeCompare(b.tier_id));
  const configHash = sha256(canonicalJson(config));

  const randomness = 'dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd';
  const signature = 'ZGVtby1kcmFuLXNpZw==';
  const snapshotHeader = {
    config_hash: configHash,
    drand_round: WORLD.drand_round,
    drop_id: WORLD.drop_id,
    exclusions_hash: exclusionsHash,
    version: 'fairdrop-snapshot/2'
  };
  const canonicalBlob = [canonicalJson(snapshotHeader), ...rankedEntries.slice().sort((a, b) => a.entry_id.localeCompare(b.entry_id)).map(({ accepted_at, entry_id, quantity, tier_id }) => canonicalJson({ accepted_at, entry_id, quantity, tier_id }))].join('\n') + '\n';
  const canonicalHash = sha256(canonicalBlob);
  const timestampProof = { chain: WORLD.drand_chain, round: WORLD.drand_round, randomness, signature };
  const evidenceHeaders = {
    'X-Fairdrop-Snapshot-Sha256': canonicalHash,
    'X-Fairdrop-Exclusions-Sha256': exclusionsHash,
    'X-Fairdrop-Sealed-At': WORLD.closes_at,
    'X-Fairdrop-Timestamped-At': '2026-10-04T13:12:00Z',
    'X-Fairdrop-Timestamp-Proof': Buffer.from(JSON.stringify(timestampProof)).toString('base64')
  };

  const remaining = Object.fromEntries(WORLD.tiers.map(tier => [tier.tier_id, tier.capacity]));
  const allocation = [];
  for (const entry of rankedEntries) {
    if (entry.quantity <= remaining[entry.tier_id]) {
      const offerHash = sha256(`offer:${entry.entry_id}`);
      const offer_id = entry.entry_id === WORLD.viewer.entry_id ? WORLD.viewer.offer_id
        : `${offerHash.slice(0,8)}-${offerHash.slice(8,12)}-${offerHash.slice(12,16)}-${offerHash.slice(16,20)}-${offerHash.slice(20,32)}`;
      allocation.push({ entry_id: entry.entry_id, tier_id: entry.tier_id, quantity: entry.quantity, round: 0, offer_id });
      remaining[entry.tier_id] -= entry.quantity;
    }
  }
  const held = Object.fromEntries(WORLD.tiers.map(tier => [tier.tier_id, tier.capacity - remaining[tier.tier_id]]));

  const isSealed = phase => ['sealed', 'drawn', 'settled'].includes(phase);
  const makeDrop = phase => ({
    drop_id: WORLD.drop_id,
    name: WORLD.name,
    venue: WORLD.venue,
    starts_at: WORLD.starts_at,
    opens_at: WORLD.opens_at,
    closes_at: WORLD.closes_at,
    allocation_mode: WORLD.allocation_mode,
    pow_required: WORLD.pow_required,
    turnstile_required: WORLD.turnstile_required,
    pow_bits: WORLD.pow_bits,
    pow_k: WORLD.pow_k,
    pow_memory_kib: WORLD.pow_memory_kib,
    max_quantity: WORLD.max_quantity,
    offer_ttl_s: WORLD.offer_ttl_s,
    pay_deadline_s: WORLD.pay_deadline_s,
    max_promotion_rounds: WORLD.max_promotion_rounds,
    sybil_rules: WORLD.sybil_rules,
    drand_chain: WORLD.drand_chain,
    drand_round: WORLD.drand_round,
    drand_round_due_at: WORLD.drand_round_due_at,
    config_hash: configHash,
    phase,
    tiers: WORLD.tiers.map(({ tier_id, name, price_paise, capacity }) => ({ tier_id, name, price_paise, capacity })),
    counts: {
      entries: WORLD.entry_count,
      eligible: isSealed(phase) ? rankedEntries.length : null,
      excluded: isSealed(phase) ? exclusions.length : null
    },
    snapshot: isSealed(phase) ? {
      canonical_hash: canonicalHash,
      exclusions_hash: exclusionsHash,
      sealed_at: WORLD.closes_at,
      timestamped_at: evidenceHeaders['X-Fairdrop-Timestamped-At']
    } : null,
    server_time: PHASE_SERVER_TIME[phase]
  });

  const open = makeDrop('open');
  const sealed = makeDrop('sealed');
  const drawn = makeDrop('drawn');
  const settled = makeDrop('settled');
  const scheduled = makeDrop('scheduled');
  const viewer = WORLD.viewer;
  const receipt = {
    drop_id: WORLD.drop_id,
    entry_id: viewer.entry_id,
    tier_id: viewer.tier_id,
    quantity: viewer.quantity,
    config_hash: configHash,
    accepted_at: viewer.accepted_at
  };
  const makeEntry = (status, rank = null, waitlist_position = null, exclusion_reason = null) => ({
    entry_id: viewer.entry_id,
    tier_id: viewer.tier_id,
    quantity: viewer.quantity,
    status,
    rank,
    waitlist_position,
    exclusion_reason
  });
  const baseOffer = {
    offer_id: viewer.offer_id,
    tier_id: viewer.tier_id,
    quantity: viewer.quantity,
    amount_paise: WORLD.tiers.find(tier => tier.tier_id === viewer.tier_id).price_paise * viewer.quantity,
    round: 0,
    status: 'offered',
    expires_at: '2026-10-04T13:22:30Z',
    pay_deadline: null
  };
  const makeMe = (phase, status, rank = null, waitlist_position = null, exclusion_reason = null, offer = null) => ({
    phase,
    server_time: PHASE_SERVER_TIME[phase],
    entry: status ? makeEntry(status, rank, waitlist_position, exclusion_reason) : null,
    offer
  });

  const draw = {
    drop_id: WORLD.drop_id,
    round: WORLD.drand_round,
    drawn_at: PHASE_SERVER_TIME.drawn,
    signature,
    randomness,
    relays: ['api.drand.sh', 'drand.cloudflare.com'],
    ranked_entry_ids: ranked,
    allocation
  };
  const invariants = phaseDrop => ({
    tiers: phaseDrop.tiers.map(tier => {
      const tierHeld = phaseDrop.phase === 'drawn'
        ? held[tier.tier_id]
        : phaseDrop.phase === 'settled' ? WORLD.settled_held[tier.tier_id] : 0;
      return {
        tier_id: tier.tier_id,
        held: tierHeld,
        active_offer_units: tierHeld,
        capacity: tier.capacity
      };
    }),
    oversell: 0,
    held_mismatch: 0,
    double_redemption: 0
  });
  const activeOutcomeIds = new Set();
  for (const tier of WORLD.tiers) {
    const rows = allocation.filter(item => item.tier_id === tier.tier_id);
    const target = WORLD.settled_held[tier.tier_id];
    const reached = new Uint8Array(target + 1);
    const previousAmount = new Int32Array(target + 1).fill(-1);
    const previousIndex = new Int32Array(target + 1).fill(-1);
    reached[0] = 1;
    rows.forEach((item, index) => {
      for (let amount = target - item.quantity; amount >= 0; amount--) {
        const nextAmount = amount + item.quantity;
        if (reached[amount] && !reached[nextAmount]) {
          reached[nextAmount] = 1;
          previousAmount[nextAmount] = amount;
          previousIndex[nextAmount] = index;
        }
      }
    });
    if (!reached[target]) throw new Error(`cannot settle ${tier.tier_id} to ${target} active units`);
    for (let amount = target; amount > 0;) {
      const index = previousIndex[amount];
      activeOutcomeIds.add(rows[index].entry_id);
      amount = previousAmount[amount];
    }
  }

  let activeIndex = 0;
  let releasedIndex = 0;
  const activeStatuses = ['offered', 'payment_pending', 'confirmed'];
  const releasedStatuses = ['expired', 'declined', 'payment_failed'];
  const outcomes = allocation.map(item => {
    const entry = rankedEntries.find(candidate => candidate.entry_id === item.entry_id);
    const status = activeOutcomeIds.has(item.entry_id)
      ? activeStatuses[activeIndex++ % activeStatuses.length]
      : releasedStatuses[releasedIndex++ % releasedStatuses.length];
    return { entry_id: item.entry_id, identity_id: entry.identity_id, quantity: item.quantity, status };
  });

  const results = {
    schema_version: 1,
    source: 'fixture',
    modes: ['naive_fcfs', 'hardened_fcfs', 'lottery_wil'].map((mode, index) => {
      const profiles = {
        honest_singles: { bot: false, cohort: 'singles', identities: 180, entries: 200, tickets_won: [160, 178, 180][index] },
        speed_bots: { bot: true, cohort: 'bots', identities: 40, entries: 180, tickets_won: [95, 63, 20][index] },
        honest_groups: { bot: false, cohort: 'group_members', identities: 20, entries: 40, tickets_won: [0, 9, 70][index] }
      };
      const sum = field => Object.values(profiles).reduce((n, p) => n + p[field], 0);
      const tickets_won = sum('tickets_won');
      const identities = sum('identities');
      const bot_ticket_share = profiles.speed_bots.tickets_won / tickets_won;
      const bot_identity_share = profiles.speed_bots.identities / identities;
      const group_members = profiles.honest_groups.tickets_won;
      const singles = profiles.honest_singles.tickets_won;
      return {
        mode, entries: sum('entries'), identities, tickets_won, profiles,
        bot_ticket_share, bot_identity_share, bot_share_ratio: bot_ticket_share / bot_identity_share,
        groups_vs_singles: { group_members, singles, ratio: singles ? group_members / singles : 0 },
        exclusions_per_rule: index === 2 ? WORLD.exclusions : {},
        invariants: { held_within_capacity: true, held_matches_active_offers: true, oversell: 0, double_redemption: 0 }
      };
    })
  };

  return {
    'listDrops.200.json': {
      drops: [{
        drop_id: open.drop_id,
        name: open.name,
        venue: open.venue,
        starts_at: open.starts_at,
        opens_at: open.opens_at,
        closes_at: open.closes_at,
        allocation_mode: open.allocation_mode,
        phase: open.phase
      }],
      server_time: WORLD.server_time
    },
    'getDrop.200.json': open,
    'getDrop.200.scheduled.json': scheduled,
    'getDrop.200.open.json': open,
    'getDrop.200.sealed.json': sealed,
    'getDrop.200.drawn.json': drawn,
    'getDrop.200.settled.json': settled,
    'login.200.json': { token: 'mock.identity.token', identity_id: viewer.identity_id, expires_at: '2026-10-04T14:00:00Z' },
    'getPowChallenge.200.json': { challenge: sha256(`${WORLD.drop_id}:${viewer.identity_id}`), issued_at: WORLD.server_time, bits: WORLD.pow_bits, k: WORLD.pow_k, memory_kib: WORLD.pow_memory_kib },
    'createEntry.201.json': { entry_id: viewer.entry_id, receipt, receipt_sig: 'ZGVtby1lZDI1NTE5LXJlY2VpcHQtc2lnbmF0dXJl' },
    'createEntry.200.json': { entry_id: viewer.entry_id, receipt, receipt_sig: 'ZGVtby1lZDI1NTE5LXJlY2VpcHQtc2lnbmF0dXJl' },
    'getMe.200.none.json': makeMe('open', null),
    'getMe.200.registered.json': makeMe('open', 'registered'),
    'getMe.200.excluded.json': makeMe('sealed', 'excluded', null, null, 'sybil:device'),
    'getMe.200.waitlisted.json': makeMe('drawn', 'waitlisted', 1854, 42),
    'getMe.200.not_selected.json': makeMe('settled', 'not_selected', 2150),
    'getMe.200.offered.json': makeMe('drawn', 'offered', viewer.rank, null, null, baseOffer),
    'getMe.200.payment_pending.json': makeMe('drawn', 'payment_pending', viewer.rank, null, null, { ...baseOffer, status: 'payment_pending', pay_deadline: '2026-10-04T13:18:30Z' }),
    'getMe.200.confirmed.json': makeMe('drawn', 'confirmed', viewer.rank, null, null, { ...baseOffer, status: 'confirmed', pay_deadline: '2026-10-04T13:18:30Z' }),
    'getMe.200.expired.json': makeMe('drawn', 'expired', viewer.rank, null, null, { ...baseOffer, status: 'expired' }),
    'getMe.200.declined.json': makeMe('drawn', 'declined', viewer.rank, null, null, { ...baseOffer, status: 'declined' }),
    'getMe.200.payment_failed.json': makeMe('drawn', 'payment_failed', viewer.rank, null, null, { ...baseOffer, status: 'payment_failed', pay_deadline: '2026-10-04T13:18:30Z' }),
    'redeemOffer.200.json': { offer_id: viewer.offer_id, order_id: '2d1f7d38-6f18-45e4-a0d1-e9b3b71ce102', status: 'payment_pending', pay_deadline: '2026-10-04T13:18:30Z' },
    'createPaymentCheckout.200.json': {
      provider: 'razorpay', key_id: 'rzp_test_fixture', provider_order_id: 'order_fixture',
      amount_paise: baseOffer.amount_paise, currency: 'INR', pay_deadline: '2026-10-04T13:18:30Z'
    },
    'createPaymentCheckout.503.payment_unavailable.json': { error: 'payment_unavailable', message: 'Razorpay Test Mode is not configured.' },
    'payOffer.409.payment_unavailable.json': { error: 'payment_unavailable', message: 'Razorpay could not complete the request.' },
    'payOffer.200.confirmed.json': { status: 'confirmed' },
    'payOffer.200.payment_failed.json': { status: 'payment_failed' },
    'declineOffer.200.json': { status: 'declined' },
    'getDraw.200.json': draw,
    'getInvariants.200.json': invariants(open),
    'getInvariants.200.open.json': invariants(open),
    'getInvariants.200.drawn.json': invariants(drawn),
    'getInvariants.200.settled.json': invariants(settled),
    'getSnapshot.200.ndjson': canonicalBlob,
    'getSnapshot.200.headers.json': evidenceHeaders,
    'getExclusions.200.ndjson': exclusionsBlob,
    'getExclusions.200.headers.json': evidenceHeaders,
    'getKeys.200.json': {
      receipt: {
        alg: 'Ed25519',
        public_key: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
        kid: 'fairdrop-receipt-v1'
      }
    },
    'adminOpen.200.json': makeDrop('open'),
    'adminSeal.200.json': sealed,
    'adminDraw.200.json': drawn,
    'adminCreateDrop.201.json': scheduled,
    'adminOutcomes.200.json': { outcomes },
    'adminReset.200.json': { ok: true },
    'results.json': results,
    'createEntry.409.entry_exists_different_terms.json': { error: 'entry_exists_different_terms', message: 'An entry already exists with different terms.' },
    'createEntry.403.window_closed.json': { error: 'window_closed', message: 'The registration window is closed.' },
    'createEntry.400.turnstile_failed.json': { error: 'turnstile_failed', message: 'The human check could not be verified.' },
    'createEntry.400.unknown_tier.json': { error: 'unknown_tier', message: 'That ticket tier is not available.' },
    'createEntry.400.quantity_exceeds_max.json': { error: 'quantity_exceeds_max', message: 'The requested quantity is above the limit.' },
    'createEntry.400.invalid_request.json': { error: 'invalid_request', message: 'The entry request is invalid.' },
    'getMe.401.unauthorized.json': { error: 'unauthorized', message: 'Please sign in again.' },
    'redeemOffer.403.offer_not_yours.json': { error: 'offer_not_yours', message: 'This offer belongs to another account.' },
    'redeemOffer.409.offer_expired.json': { error: 'offer_expired', message: 'This offer has expired.' },
    'redeemOffer.409.already_redeemed_other_order.json': { error: 'already_redeemed_other_order', message: 'This offer was redeemed with another order.' },
    'redeemOffer.409.not_offered.json': { error: 'not_offered', message: 'This entry does not have an active offer.' },
    'payOffer.409.payment_window_closed.json': { error: 'payment_window_closed', message: 'The payment window has closed.', refund: true },
    'payOffer.409.not_payment_pending.json': { error: 'not_payment_pending', message: 'This offer is not waiting for payment.' }
  };

  return Object.fromEntries(Object.entries(results).sort(([a], [b]) => a.localeCompare(b)));
}

function writeFixtures(directory = path.dirname(fileURLToPath(import.meta.url))) {
  const fixtures = buildFixtures();
  mkdirSync(directory, { recursive: true });
  const generatedFiles = new Set(Object.keys(fixtures));
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.isFile() && /\.(json|ndjson)$/.test(entry.name) && !generatedFiles.has(entry.name)) {
      rmSync(path.join(directory, entry.name));
    }
  }
  for (const [name, value] of Object.entries(fixtures)) {
    const contents = name.endsWith('.ndjson') ? value : `${JSON.stringify(value, null, 2)}\n`;
    writeFileSync(path.join(directory, name), contents);
  }
  return Object.keys(fixtures);
}

export { WORLD, buildFixtures, writeFixtures };

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  writeFixtures();
}
