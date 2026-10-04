import test from 'node:test';
import assert from 'node:assert/strict';
import { screenFor } from './screen.js';

test('screenFor returns detail until an authenticated entry exists', () => {
  assert.equal(screenFor('open', { entry: { status: 'offered' } }, false), 'detail');
  assert.equal(screenFor('open', { entry: null }, true), 'detail');
  assert.equal(screenFor('open', null, true), 'detail');
});

test('screenFor routes registered entries by the server phase', () => {
  const registered = { entry: { status: 'registered' } };
  assert.equal(screenFor('open', registered, true), 'registered');
  assert.equal(screenFor('sealed', registered, true), 'sealed');
});

test('screenFor uses every other server entry status as the screen name', () => {
  for (const status of [
    'excluded', 'waitlisted', 'offered', 'payment_pending', 'confirmed',
    'expired', 'declined', 'payment_failed', 'not_selected'
  ]) {
    assert.equal(screenFor('drawn', { entry: { status } }, true), status);
  }
});
