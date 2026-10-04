import { timestampMicros } from './canonical.js';

const compareText = (left, right) => left < right ? -1 : left > right ? 1 : 0;

function hexBytes(value, length, label) {
  if (typeof value !== 'string' || value.length !== length * 2 || !/^[\da-f]+$/i.test(value)) {
    throw new TypeError(`${label} must be ${length} bytes of hexadecimal`);
  }
  return Uint8Array.from(value.match(/../g), pair => Number.parseInt(pair, 16));
}

function uuidBytes(value) {
  return hexBytes(String(value).replaceAll('-', ''), 16, 'drop_id');
}

function concatBytes(...parts) {
  const result = new Uint8Array(parts.reduce((size, part) => size + part.length, 0));
  let offset = 0;
  for (const part of parts) { result.set(part, offset); offset += part.length; }
  return result;
}

export async function rankDigest(dropId, randomness, entryId) {
  const prefix = new TextEncoder().encode('fairdrop/rank/v1\0');
  const bytes = concatBytes(prefix, uuidBytes(dropId), hexBytes(randomness, 32, 'randomness'), hexBytes(entryId, 16, 'entry_id'));
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  let value = BigInt(`0x${Array.from(hash, byte => byte.toString(16).padStart(2, '0')).join('')}`);
  return value || 1n;
}

export async function lotteryOrder(entries, dropId, randomness) {
  const ranked = await Promise.all(entries.map(async entry => {
    const quantity = entry.quantity;
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 4) throw new TypeError('quantity must be 1 to 4');
    const value = await rankDigest(dropId, randomness, entry.entry_id);
    return { entry, key: (value ** BigInt(quantity)) << BigInt(256 * (4 - quantity)) };
  }));
  ranked.sort((a, b) => a.key === b.key
    ? compareText(a.entry.entry_id, b.entry.entry_id)
    : a.key > b.key ? -1 : 1);
  return ranked.map(row => row.entry);
}

export function fcfsOrder(entries) {
  return [...entries].sort((a, b) => {
    const left = timestampMicros(a.accepted_at), right = timestampMicros(b.accepted_at);
    return left === right ? compareText(a.entry_id, b.entry_id) : left < right ? -1 : 1;
  });
}

export function initialAllocation(rankedEntries, tiers) {
  const remaining = new Map(tiers.map(tier => [tier.tier_id, tier.capacity]));
  const allocated = [];
  for (const entry of rankedEntries) {
    const capacity = remaining.get(entry.tier_id);
    if (capacity == null) throw new Error(`Unknown tier ${entry.tier_id}`);
    if (capacity >= entry.quantity) {
      remaining.set(entry.tier_id, capacity - entry.quantity);
      allocated.push({ entry_id: entry.entry_id, tier_id: entry.tier_id, quantity: entry.quantity });
    }
  }
  return allocated;
}

