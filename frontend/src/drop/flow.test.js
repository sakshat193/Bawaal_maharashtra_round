import test from 'node:test';
import assert from 'node:assert/strict';
import * as flow from './flow.js';
import { createEntryBody, formatCountdown, formatPaise, getOrCreateOrderId } from './flow.js';

test('entry request copies the proof and uses the API field names', () => {
  const body = createEntryBody({
    tierId: 'gold',
    quantity: 2,
    turnstileToken: 'turnstile-proof',
    issuedAt: '2026-10-04T13:05:00Z',
    nonces: [3, 8]
  });

  assert.deepEqual(body, {
    tier_id: 'gold',
    quantity: 2,
    turnstile_token: 'turnstile-proof',
    pow: { issued_at: '2026-10-04T13:05:00Z', nonces: [3, 8] }
  });
});

test('entry request omits an absent Turnstile token and includes a present token', () => {
  const base = { tierId: 'gold', quantity: 1, issuedAt: '2026-10-04T13:05:00Z', nonces: [] };
  const withoutToken = createEntryBody(base);
  const withToken = createEntryBody({ ...base, turnstileToken: 'turnstile-proof' });

  assert.equal('turnstile_token' in withoutToken, false);
  assert.equal('turnstile_token' in withToken, true);
  assert.equal(withToken.turnstile_token, 'turnstile-proof');
});

test('entry request omits pow when no proof of work was issued', () => {
  const body = createEntryBody({ tierId: 'gold', quantity: 1, nonces: [] });
  assert.equal('pow' in body, false);
});

test('countdown uses server time and clamps elapsed deadlines', () => {
  assert.equal(formatCountdown('2026-10-04T13:10:00Z', Date.parse('2026-10-04T13:00:01Z')), '09:59');
  assert.equal(formatCountdown('2026-10-04T12:59:59Z', Date.parse('2026-10-04T13:00:00Z')), '00:00');
});

test('money formatting preserves integer paise with Indian grouping', () => {
  assert.equal(formatPaise(900000), '₹9,000');
  assert.equal(formatPaise(900001), '₹9,000.01');
});

test('order id is created once and reused for the same offer', () => {
  const values = new Map();
  const storage = {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value)
  };

  const first = getOrCreateOrderId('offer-1', storage, () => 'order-1');
  const second = getOrCreateOrderId('offer-1', storage, () => 'order-2');

  assert.equal(first, 'order-1');
  assert.equal(second, first);
});


test('Razorpay body uses the original stored order and only the provider fields', () => {
  assert.equal(typeof flow.razorpayPaymentBody, 'function');
  const proof={razorpay_order_id:'provider-order',razorpay_payment_id:'payment',razorpay_signature:'signature',extra:'discard'};
  assert.deepEqual(flow.razorpayPaymentBody('original-order',proof),{
    order_id:'original-order',provider:'razorpay',razorpay_order_id:'provider-order',razorpay_payment_id:'payment',razorpay_signature:'signature'
  });
  assert.throws(()=>flow.razorpayPaymentBody(null,proof));
});
