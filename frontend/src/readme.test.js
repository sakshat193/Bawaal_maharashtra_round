import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('README documents current hash routes, environment and schema dependency', () => {
  const readme=readFileSync(new URL('../README.md',import.meta.url),'utf8');
  for(const value of ['HashRouter','/#/','/#/judges','/#/demo','/#/drops/<id>','VITE_MSW','VITE_PROXY_TARGET','VITE_TURNSTILE_SITEKEY','contracts/openapi.yaml','M2']) {
    assert.ok(readme.includes(value),`${value} is documented`);
  }
  assert.doesNotMatch(readme,/store\.js simulates|recompute all 49,812/);
});
