import test from 'node:test';
import assert from 'node:assert/strict';
import { drumCounts } from './drum.js';

test('drum points follow server entry and winner counts with a shared scale', () => {
  assert.deepEqual(drumCounts(9000, 500), {
    unitSize: 1,
    entryPoints: 9000,
    winnerPoints: 500
  });
  assert.deepEqual(drumCounts(50001, 801), {
    unitSize: 2,
    entryPoints: 25001,
    winnerPoints: 401
  });
});

test('drum scale clamps invalid counts and never lights winners beyond entries', () => {
  assert.deepEqual(drumCounts(-1, 4), { unitSize: 1, entryPoints: 0, winnerPoints: 0 });
  assert.deepEqual(drumCounts(5, 9), { unitSize: 1, entryPoints: 5, winnerPoints: 5 });
});
