const encoder = new TextEncoder();
const compareText = (left, right) => left < right ? -1 : left > right ? 1 : 0;
const entryIdPattern = /^[0-9a-f]{32}$/;
const hashPattern = /^[0-9a-f]{64}$/;

function jsonValue(value) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value)) throw new TypeError('Canonical JSON accepts integers only');
    return value;
  }
  if (Array.isArray(value)) return value.map(jsonValue);
  if (typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, jsonValue(value[key])]));
  }
  throw new TypeError(`Unsupported canonical value: ${typeof value}`);
}

export function canonicalJson(value) {
  return JSON.stringify(jsonValue(value)).replace(/[\u007f-\uffff]/g, char =>
    `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`
  );
}

export function timestampMicros(value) {
  const match = /^(\d{4})-(\d\d)-(\d\d)T(\d\d):(\d\d):(\d\d)(?:\.(\d{1,6}))?(Z|[+-]\d\d:\d\d)$/.exec(value);
  if (!match) throw new TypeError(`Invalid offset-aware timestamp: ${value}`);
  const [, y, mo, d, h, mi, s, fraction = '', zone] = match;
  const sign = zone === 'Z' ? 0 : zone[0] === '+' ? 1 : -1;
  const offset = zone === 'Z' ? 0 : sign * (Number(zone.slice(1, 3)) * 60 + Number(zone.slice(4, 6)));
  const utcMillis = Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s)) - offset * 60_000;
  return BigInt(utcMillis) * 1000n + BigInt(fraction.padEnd(6, '0'));
}

export function formatTimestamp(value, microseconds = false) {
  const micros = timestampMicros(value);
  const millis = Number(micros / 1000n);
  const whole = new Date(millis).toISOString().slice(0, 19);
  return microseconds ? `${whole}.${(micros % 1_000_000n).toString().padStart(6, '0')}Z` : `${whole}Z`;
}

export function canonicalConfigBytes(drop, tiers) {
  const config = { ...drop };
  delete config.phase;
  delete config.config_hash;
  delete config.tiers;
  for (const key of ['starts_at', 'opens_at', 'closes_at']) {
    if (config[key] != null) config[key] = formatTimestamp(config[key]);
  }
  config.tiers = tiers.map(tier => {
    const stable = { ...tier };
    delete stable.held;
    delete stable.general_sale_units;
    return stable;
  }).sort((a, b) => compareText(a.tier_id, b.tier_id));
  if (new Set(config.tiers.map(tier => tier.tier_id)).size !== config.tiers.length) throw new Error('tier_id values must be unique');
  return encoder.encode(canonicalJson(config));
}

export function canonicalExclusionsBytes(rows) {
  if (rows.some(row => !entryIdPattern.test(row.entry_id) || typeof row.reason !== 'string' || !row.reason)) {
    throw new Error('Exclusion rows need a 32-character entry_id and a reason');
  }
  if (new Set(rows.map(row => row.entry_id)).size !== rows.length) throw new Error('An entry can have only one exclusion row');
  return encoder.encode(rows
    .map(({ entry_id, reason }) => ({ entry_id, reason }))
    .sort((a, b) => compareText(a.entry_id, b.entry_id))
    .map(row => `${canonicalJson(row)}\n`).join(''));
}

export function canonicalSnapshotBytes(header, entries) {
  const first = {
    config_hash: header.config_hash,
    drand_round: header.drand_round,
    drop_id: header.drop_id,
    exclusions_hash: header.exclusions_hash,
    version: 'fairdrop-snapshot/2',
  };
  if (!/^[0-9a-f-]{36}$/i.test(first.drop_id) || !Number.isSafeInteger(first.drand_round) || first.drand_round < 1) {
    throw new Error('Snapshot needs a UUID drop_id and positive drand_round');
  }
  if (!hashPattern.test(first.config_hash) || !hashPattern.test(first.exclusions_hash)) throw new Error('Snapshot hashes must be lowercase SHA-256 hex');
  const rows = entries.map(entry => ({
    accepted_at: formatTimestamp(entry.accepted_at, true),
    entry_id: entry.entry_id,
    quantity: entry.quantity,
    tier_id: entry.tier_id,
  })).sort((a, b) => compareText(a.entry_id, b.entry_id));
  if (rows.some(row => !entryIdPattern.test(row.entry_id) || !Number.isInteger(row.quantity) || row.quantity < 1 || row.quantity > 4 || typeof row.tier_id !== 'string' || !row.tier_id)) {
    throw new Error('Snapshot entries have invalid IDs, quantity, or tier');
  }
  if (new Set(rows.map(row => row.entry_id)).size !== rows.length) throw new Error('Snapshot entry_id values must be unique');
  return encoder.encode(`${canonicalJson(first)}\n${rows.map(row => `${canonicalJson(row)}\n`).join('')}`);
}

export function canonicalReceiptBytes(receipt) {
  const value = { ...receipt };
  if (value.accepted_at != null) value.accepted_at = formatTimestamp(value.accepted_at, true);
  return encoder.encode(canonicalJson(value));
}

export async function sha256Hex(bytes) {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

export function parseSnapshot(bytes) {
  const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  if (!text.endsWith('\n')) throw new Error('Snapshot is missing its final newline');
  const lines = text.slice(0, -1).split('\n');
  if (lines.some(line => !line)) throw new Error('Snapshot contains an empty line');
  const [header, ...entries] = lines.map(line => JSON.parse(line));
  const headerFields = ['config_hash', 'drand_round', 'drop_id', 'exclusions_hash', 'version'].sort();
  if (Object.keys(header).sort().join() !== headerFields.join()) throw new Error('Snapshot header has the wrong fields');
  if (header.version !== 'fairdrop-snapshot/2') throw new Error('Unsupported snapshot version');
  const entryFields = ['accepted_at', 'entry_id', 'quantity', 'tier_id'].sort();
  if (entries.some(row => Object.keys(row).sort().join() !== entryFields.join())) throw new Error('Snapshot entry has the wrong fields');
  if (entries.some((row, index) => index && entries[index - 1].entry_id > row.entry_id)) throw new Error('Snapshot entries are not sorted');
  if (new TextDecoder().decode(canonicalSnapshotBytes(header, entries)) !== text) {
    throw new Error('Snapshot is not canonical');
  }
  return { header, entries };
}

export function parseExclusions(bytes) {
  const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  if (text && !text.endsWith('\n')) throw new Error('Exclusions are missing their final newline');
  const rows = text ? text.slice(0, -1).split('\n').map(line => JSON.parse(line)) : [];
  if (new TextDecoder().decode(canonicalExclusionsBytes(rows)) !== text) throw new Error('Exclusions are not canonical');
  return rows;
}

