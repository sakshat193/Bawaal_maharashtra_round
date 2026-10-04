import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { RULE_TEXT, messageForError, ERROR_MESSAGES } from './messages.js';

const fixtureDirectory = new URL('../../../contracts/fixtures/', import.meta.url);

test('every error fixture has a user-facing sentence', () => {
  const codes = readdirSync(fixtureDirectory)
    .filter(file => file.endsWith('.json'))
    .map(file => JSON.parse(readFileSync(new URL(file, fixtureDirectory), 'utf8')).error)
    .filter(Boolean);

  assert.ok(codes.length > 0);
  for (const code of codes) {
    assert.equal(typeof ERROR_MESSAGES[code], 'string', `${code} has a sentence`);
    assert.match(ERROR_MESSAGES[code], /[.!?]$/);
    assert.equal(messageForError({ code }), ERROR_MESSAGES[code]);
  }
});

test('RULE_TEXT explains each published rule kind in plain language', () => {
  assert.match(RULE_TEXT({ kind: 'max_per_device', limit: 2 }), /device/i);
  assert.match(RULE_TEXT({ kind: 'max_per_payment', limit: 2 }), /payment/i);
  assert.match(RULE_TEXT({ kind: 'min_account_age_s', value: 86400 }), /account/i);
  assert.match(RULE_TEXT({ kind: 'unknown_rule' }), /eligibility/i);
  assert.match(messageForError({ code: 'unrecognized' }), /try again/i);
});
