import test from 'node:test';
import assert from 'node:assert/strict';
import { initialScenario } from './scenarios.js';

const known = { none: {}, offered: {}, payment_pending: {} };

test('scenario query seeds a mock session with no stored state', () => {
  assert.deepEqual(initialScenario(null, 'offered', known), { scenario: 'offered', seed: true });
});

test('stored mutation scenario survives reload even when the URL has its seed scenario', () => {
  assert.deepEqual(initialScenario('payment_pending', 'offered', known), { scenario: 'payment_pending', seed: false });
});

test('unknown scenario values fall back to none', () => {
  assert.deepEqual(initialScenario('invalid', 'unknown', known), { scenario: 'none', seed: false });
});
