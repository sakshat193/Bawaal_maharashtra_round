import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resultsShapeError } from './dashboardData.js';

test('published live harness evidence passes every mode and attack', () => {
  const results = JSON.parse(readFileSync(new URL('../../public/results.json', import.meta.url), 'utf8'));
  assert.equal(results.source, 'live_harness');
  assert.equal(resultsShapeError(results), null);
  assert.equal(results.modes.length, 3);
  for (const mode of results.modes) {
    assert.equal(mode.invariants.held_within_capacity, true, mode.mode);
    assert.equal(mode.invariants.held_matches_active_offers, true, mode.mode);
    assert.equal(mode.invariants.oversell, 0, mode.mode);
    assert.equal(mode.invariants.double_redemption, 0, mode.mode);
    assert.deepEqual(mode.exclusions_per_rule, mode.mode === 'naive_fcfs' ? {} : {
      'sybil:device': mode.profiles.sybil_cluster.entries
    });
    if (mode.mode !== 'naive_fcfs') assert.equal(mode.profiles.sybil_cluster.tickets_won, 0);
    assert.deepEqual(Object.keys(mode.attack_checks).sort(),
      ['double_redeem', 'forged_redeem', 'late_payer', 'payment_failer', 'reconnect', 'replay']);
    for (const [name, check] of Object.entries(mode.attack_checks)) {
      assert.equal(check.passed, true, `${mode.mode}: ${name}`);
    }
    for (const profile of Object.values(mode.profiles)) {
      assert.equal(typeof profile.bot, 'boolean');
      assert.equal(typeof profile.cohort, 'string');
    }
    assert.equal(Object.values(mode.profiles).reduce((sum, profile) => sum + profile.tickets_won, 0), mode.tickets_won);
  }
});
