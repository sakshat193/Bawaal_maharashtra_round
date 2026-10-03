import test from 'node:test';
import assert from 'node:assert/strict';
import { layout } from './venue.js';

function tier(id, capacity, price = 1) {
  return { tier_id: id, name: id, capacity, price_paise: price };
}

function dotsByTier(result) {
  return Object.fromEntries(result.tiers.map(section => [section.tier_id, section.dots.length]));
}

test('venue layout gives one dot per ticket for one, three, and six tiers', () => {
  const worlds = [
    [tier('solo', 7)],
    [tier('gold', 3, 300), tier('silver', 5, 200), tier('bronze', 7, 100)],
    Array.from({ length: 6 }, (_, index) => tier(`tier-${index}`, index + 2, 600 - index * 100))
  ];

  for (const tiers of worlds) {
    const result = layout(tiers);
    const actual = dotsByTier(result);
    for (const item of tiers) assert.equal(actual[item.tier_id], item.capacity);
    assert.equal(result.unitSize, 1);
  }
});

test('venue layout sorts by price, then tier id, and allocates rows exactly', () => {
  const result = layout([tier('zeta', 5, 100), tier('beta', 4, 200), tier('alpha', 3, 200)]);

  assert.deepEqual(result.tiers.map(section => section.tier_id), ['alpha', 'beta', 'zeta']);
  for (const section of result.tiers) {
    assert.equal(section.rows.reduce((sum, row) => sum + row.dots.length, 0), section.dots.length);
  }
});

test('venue layout scales worlds above six thousand tickets by one shared unit size', () => {
  const result = layout([tier('gold', 6001, 200), tier('silver', 3999, 100)]);

  assert.equal(result.unitSize, 2);
  assert.deepEqual(dotsByTier(result), { gold: 3001, silver: 2000 });
  assert.equal(result.tiers.flatMap(section => section.dots).length, 5001);
});
