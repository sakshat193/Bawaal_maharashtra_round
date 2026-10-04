import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { verifyGoldenVectors } from './vectors.js';

const load = name => JSON.parse(readFileSync(new URL(`../../../contracts/vectors/${name}.json`, import.meta.url), 'utf8'));

test('golden vectors pass in the browser verifier', async () => {
  const lines = await verifyGoldenVectors({ canonical: load('canonical'), ranking: load('rank'), sybil: load('sybil') });
  assert.equal(lines.length, 6);
  for (const line of lines) assert.match(String(line.text ?? line), /PASS/);
});
