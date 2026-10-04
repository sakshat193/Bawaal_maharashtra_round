import test from 'node:test';
import assert from 'node:assert/strict';
import { labelFor, nextSelection, untilText } from './selection.js';
import { layout, seatLabels } from '../three/venue.js';

test('clicking toggles your own seats and refuses amber or red seats', () => {
  const s = { mine: [3], locked: [5], booked: [7], quantity: 2 };
  assert.deepEqual(nextSelection(4, s), { seats: [3, 4] });
  assert.deepEqual(nextSelection(3, s), { seats: [] });
  assert.deepEqual(nextSelection(5, s), { blocked: 'locked' });
  assert.deepEqual(nextSelection(7, s), { blocked: 'booked' });
});

test('when all seats are chosen, a new click swaps out the earliest choice', () => {
  assert.deepEqual(nextSelection(9, { mine: [3, 4], quantity: 2 }), { seats: [4, 9] });
  assert.deepEqual(nextSelection(9, { mine: [3], quantity: 1 }), { seats: [9] });
});

test('seat indexes are row-major and match one dot per seat', () => {
  const tiers = [{ tier_id: 'gold', name: 'Gold', price_paise: 2, capacity: 100 },
                 { tier_id: 'silver', name: 'Silver', price_paise: 1, capacity: 300 }];
  for (const section of layout(tiers, { unitSize: 1 }).tiers) {
    assert.equal(section.dots.length, section.capacity);
    const order = section.rows.flatMap(row => row.dots.map(dot => dot.index));
    assert.deepEqual(order, [...Array(section.capacity).keys()]);
    for (const row of section.rows) row.dots.forEach((dot, i) => assert.equal(dot.seat, i + 1));
  }
  const labels = seatLabels(tiers, 'gold');
  assert.deepEqual(labels[0], { row: 1, seat: 1 });
  assert.equal(labelFor(labels, 0), 'Row 1 · Seat 1');
  // Large venues still get one dot per seat on the seat map, regardless of the inventory view's scaling.
  const big = layout([{ tier_id: 'a', capacity: 9000, price_paise: 1 }], { unitSize: 1 });
  assert.equal(big.tiers[0].dots.length, 9000);
});

test('countdown text', () => {
  assert.equal(untilText('1970-01-01T00:01:05Z', 0), '1:05');
  assert.equal(untilText('1970-01-01T00:00:00Z', 5000), '0:00');
});
