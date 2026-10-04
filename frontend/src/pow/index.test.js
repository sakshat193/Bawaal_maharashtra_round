import test from 'node:test';
import assert from 'node:assert/strict';
import { solvePow } from './index.js';

test('solvePow resumes from startIndex and reports one copied progress object per nonce', async () => {
  const progress = [];
  const prior = [7];
  const result = await solvePow({ k: 3, startIndex: prior.length, prior }, update => progress.push(update));

  assert.deepEqual(result, [7, 8, 9]);
  assert.deepEqual(prior, [7]);
  assert.deepEqual(progress, [
    { index: 1, nonce: 8, solved: 2, k: 3, nonces: [7, 8] },
    { index: 2, nonce: 9, solved: 3, k: 3, nonces: [7, 8, 9] }
  ]);
  assert.notStrictEqual(progress[0].nonces, progress[1].nonces);
});

test('solvePow rejects with AbortError when its signal aborts', async () => {
  const controller = new AbortController();
  const pending = solvePow({ k: 16, startIndex: 0, prior: [] }, () => {}, controller.signal);
  controller.abort();

  await assert.rejects(pending, { name: 'AbortError' });
});

test('solvePow stops reporting progress when onProgress aborts the signal', async () => {
  const controller = new AbortController();
  let updates = 0;
  const pending = solvePow({ k: 100, startIndex: 0, prior: [] }, () => {
    updates += 1;
    controller.abort();
  }, controller.signal);

  await assert.rejects(pending, { name: 'AbortError' });
  await new Promise(resolve => setTimeout(resolve, 100));
  assert.equal(updates, 1);
});
