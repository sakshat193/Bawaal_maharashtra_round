import assert from 'node:assert/strict';
import test from 'node:test';
import { TIERS } from './data.js';

test('ticket preview exposes exactly the three venue layers', () => {
  assert.deepEqual(TIERS.map(tier => tier.id), ['floor', 'lower', 'upper']);
  assert.deepEqual(TIERS.map(tier => tier.name), [
    'Floor · standing',
    'Lower bowl',
    'Upper bowl',
  ]);
});