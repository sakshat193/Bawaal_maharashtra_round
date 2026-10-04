import test from 'node:test';
import assert from 'node:assert/strict';
import { applyCreatedReceipt, createEntryResponse } from './mockEntries.js';

test('create entry mock echoes the submitted tier and quantity in the receipt shape', () => {
  const template = {
    entry_id: 'entry-1',
    receipt: { drop_id: 'drop-1', entry_id: 'entry-1', tier_id: 'gold', quantity: 2, config_hash: 'hash', accepted_at: 'time' },
    receipt_sig: 'signature'
  };
  const response = createEntryResponse(template, { tier_id: 'silver', quantity: 3 });

  assert.deepEqual(response, {
    ...template,
    receipt: { ...template.receipt, tier_id: 'silver', quantity: 3 }
  });
});

test('registered mock me follows the stored receipt terms', () => {
  const me = { phase: 'open', entry: { status: 'registered', tier_id: 'gold', quantity: 2 } };
  assert.deepEqual(applyCreatedReceipt(me, { tier_id: 'bronze', quantity: 1 }), {
    phase: 'open', entry: { status: 'registered', tier_id: 'bronze', quantity: 1 }
  });
  assert.equal(applyCreatedReceipt({ entry: { status: 'offered' } }, { tier_id: 'bronze', quantity: 1 }).entry.status, 'offered');
});
