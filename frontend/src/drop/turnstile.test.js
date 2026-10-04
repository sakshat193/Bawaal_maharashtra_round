import test from 'node:test';
import assert from 'node:assert/strict';
import { turnstileOptions } from './turnstile.js';

test('Turnstile is bound to the enter action and clears expired or failed tokens', () => {
  const events = [];
  const options = turnstileOptions('site-key', token => events.push(token));

  assert.equal(options.sitekey, 'site-key');
  assert.equal(options.action, 'enter');
  options.callback('valid-token');
  options['expired-callback']();
  options['error-callback']();
  assert.deepEqual(events, ['valid-token', '', '']);
});
