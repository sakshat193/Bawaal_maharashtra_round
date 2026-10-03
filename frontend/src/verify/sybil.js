import { timestampMicros } from './canonical.js';

const maxFields = { max_per_device: 'device_hash', max_per_payment: 'payment_fingerprint' };
const compareText = (left, right) => left < right ? -1 : left > right ? 1 : 0;

export function applySybil(rules, facts) {
  const entries = Array.isArray(facts) ? facts : facts.entries;
  const opensAt = Array.isArray(facts) ? null : facts.opens_at;
  const byId = new Map(entries.map(entry => [entry.entry_id, entry]));
  if (byId.size !== entries.length) throw new Error('Duplicate entry_id in Sybil facts');
  const excluded = new Map();
  for (const rule of rules) {
    const { id, kind } = rule;
    const reason = `sybil:${id}`;
    if (!id) throw new Error('Every Sybil rule needs an id');
    if (maxFields[kind]) {
      if (!Number.isInteger(rule.limit) || rule.limit < 1) throw new Error(`Invalid limit for ${id}`);
      const groups = new Map();
      for (const entry of entries) {
        const value = entry[maxFields[kind]];
        if (value == null || value === '') continue;
        if (!groups.has(value)) groups.set(value, []);
        groups.get(value).push(entry.entry_id);
      }
      for (const ids of groups.values()) if (ids.length > rule.limit) {
        for (const entryId of ids) if (!excluded.has(entryId)) excluded.set(entryId, reason);
      }
    } else if (kind === 'min_account_age_s') {
      if (!Number.isSafeInteger(rule.value) || rule.value < 0) throw new Error(`Invalid age for ${id}`);
      for (const entry of entries) {
        const opening = entry.opens_at ?? opensAt;
        if (!opening) throw new Error('min_account_age_s needs opens_at in the facts');
        if (entry.account_created_at == null || timestampMicros(opening) - timestampMicros(entry.account_created_at) < BigInt(rule.value) * 1_000_000n) {
          if (!excluded.has(entry.entry_id)) excluded.set(entry.entry_id, reason);
        }
      }
    } else {
      throw new Error(`Unknown Sybil rule kind: ${kind}`);
    }
  }
  return [...excluded].sort(([a], [b]) => compareText(a, b));
}

