import {
  canonicalConfigBytes,
  canonicalExclusionsBytes,
  canonicalReceiptBytes,
  canonicalSnapshotBytes,
  sha256Hex,
} from './canonical.js';
import { fcfsOrder, lotteryOrder, rankDigest } from './rank.js';
import { applySybil } from './sybil.js';

const text = bytes => new TextDecoder().decode(bytes);

export async function verifyGoldenVectors({ canonical, ranking, sybil }) {
  const results = [];
  for (const [name, bytes] of [
    ['config', canonicalConfigBytes(canonical.config.drop, canonical.config.tiers)],
    ['exclusions', canonicalExclusionsBytes(canonical.exclusions.rows)],
    ['snapshot', canonicalSnapshotBytes(canonical.snapshot.header, canonical.snapshot.entries)],
    ['receipt', canonicalReceiptBytes(canonical.receipt.receipt)],
  ]) {
    const expected = canonical[name];
    if (text(bytes) !== expected.bytes_utf8) throw new Error(`${name} vector bytes differ`);
    if (name !== 'receipt' && await sha256Hex(bytes) !== expected.sha256) throw new Error(`${name} vector hash differs`);
    results.push(`${name}: PASS`);
  }
  for (const [entryId, expected] of Object.entries(ranking.digests)) {
    if ((await rankDigest(ranking.drop_id, ranking.randomness, entryId)).toString() !== expected) {
      throw new Error(`rank digest differs for ${entryId}`);
    }
  }
  const lottery = await lotteryOrder(ranking.entries, ranking.drop_id, ranking.randomness);
  if (lottery.map(row => row.entry_id).join() !== ranking.lottery_order.join()) throw new Error('WIL ordering vector differs');
  if (fcfsOrder(ranking.entries).map(row => row.entry_id).join() !== ranking.fcfs_order.join()) throw new Error('FCFS ordering vector differs');
  results.push('ranking: PASS');
  for (const [index, testCase] of sybil.cases.entries()) {
    const actual = applySybil(testCase.rules, { opens_at: testCase.opens_at, entries: testCase.facts });
    if (JSON.stringify(actual) !== JSON.stringify(testCase.expected)) throw new Error(`Sybil vector ${index} differs`);
    if (index === 0 && JSON.stringify(applySybil(testCase.rules, { opens_at: testCase.opens_at, entries: testCase.shuffled_facts })) !== JSON.stringify(testCase.shuffled_expected)) {
      throw new Error('shuffled Sybil vector differs');
    }
    const exclusionRows = actual.map(([entry_id, reason]) => ({ entry_id, reason }));
    if (text(canonicalExclusionsBytes(exclusionRows)) !== testCase.expected_bytes_utf8) throw new Error(`Sybil bytes differ for vector ${index}`);
  }
  results.push('Sybil rules and shuffled inputs: PASS');
  return results;
}

