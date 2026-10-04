import test from 'node:test';
import assert from 'node:assert/strict';
import { CONCERTS, present } from './data.js';

test('present adds stable styling to a server drop without inventing drop facts', () => {
  const drop = {
    drop_id: '6f1c2b9e-3d4a-4e8b-9a71-0c5d2e7f8a13',
    name: 'Fair Drop Live',
    venue: 'NSCI Dome, Mumbai',
    starts_at: '2026-10-04T14:00:00Z',
    phase: 'open',
    tiers: [{ tier_id: 'gold', name: 'Gold', price_paise: 450000, capacity: 300 }]
  };

  assert.deepEqual(Object.keys(CONCERTS[0]).sort(), ['hue', 'hue2', 'photo']);
  const first = present(drop);
  const second = present(drop);
  assert.deepEqual([first.hue, first.hue2, first.photo], [second.hue, second.hue2, second.photo]);
  assert.equal(first.name, drop.name);
  assert.equal(first.phase, drop.phase);
  for (const key of ['tag', 'doors', 'age', 'from', 'status', 'sold', 'lineup']) {
    assert.equal(first[key], undefined, `${key} is not fabricated`);
  }
});
