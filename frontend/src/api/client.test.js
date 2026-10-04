import assert from 'node:assert/strict';
import test from 'node:test';
import { ApiError, apiRequest } from './client.js';

test('apiRequest sends JSON and the identity bearer token', async () => {
  const previousFetch = globalThis.fetch;
  let request;
  globalThis.fetch = async (path, options) => {
    request = { path, options };
    return { ok: true, json: async () => ({ status: 'payment_pending' }) };
  };

  try {
    const result = await apiRequest('/api/offers/id/redeem', {
      method: 'POST',
      token: 'identity-token',
      body: { order_id: 'order-id' },
    });

    assert.equal(request.path, '/api/offers/id/redeem');
    assert.equal(request.options.method, 'POST');
    assert.equal(request.options.headers.get('Authorization'), 'Bearer identity-token');
    assert.equal(request.options.headers.get('Content-Type'), 'application/json');
    assert.deepEqual(JSON.parse(request.options.body), { order_id: 'order-id' });
    assert.deepEqual(result, { status: 'payment_pending' });
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test('apiRequest preserves structured API errors', async () => {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: false,
    status: 409,
    json: async () => ({ error: 'offer_expired', message: 'Offer expired' }),
  });

  try {
    await assert.rejects(apiRequest('/api/offers/id/redeem'), error => {
      assert.ok(error instanceof ApiError);
      assert.equal(error.status, 409);
      assert.equal(error.code, 'offer_expired');
      assert.equal(error.message, 'Offer expired');
      return true;
    });
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test('apiRequest explains that server errors require the ticket services', async () => {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: false,
    status: 500,
    json: async () => null,
  });

  try {
    await assert.rejects(apiRequest('/api/drops'), error => {
      assert.ok(error instanceof ApiError);
      assert.equal(error.status, 500);
      assert.match(error.message, /API and Postgres/);
      return true;
    });
  } finally {
    globalThis.fetch = previousFetch;
  }
});