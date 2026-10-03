import test from 'node:test';
import assert from 'node:assert/strict';
import { api, ApiError, serverNow } from './client.js';

function installGlobals(t, { storage = {}, fetchImpl, now } = {}) {
  const storageEntries = new Map(Object.entries(storage));
  const fakeStorage = {
    getItem: key => storageEntries.get(key) ?? null,
    setItem: (key, value) => storageEntries.set(key, String(value)),
    removeItem: key => storageEntries.delete(key)
  };
  const oldFetch = globalThis.fetch;
  const oldStorage = Object.getOwnPropertyDescriptor(globalThis, 'sessionStorage');
  const oldNow = Date.now;
  Object.defineProperty(globalThis, 'sessionStorage', { value: fakeStorage, configurable: true });
  if (fetchImpl) globalThis.fetch = fetchImpl;
  if (now !== undefined) Date.now = () => now;
  t.after(() => {
    globalThis.fetch = oldFetch;
    Date.now = oldNow;
    if (oldStorage) Object.defineProperty(globalThis, 'sessionStorage', oldStorage);
    else delete globalThis.sessionStorage;
  });
  return { storageEntries, fakeStorage };
}

const jsonResponse = (data, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: { 'Content-Type': 'application/json' }
});

test('api sends the identity bearer token and tracks server clock skew', async t => {
  let request;
  installGlobals(t, {
    storage: { 'fd.jwt': 'identity-token' },
    now: 1000,
    fetchImpl: async (_path, init) => {
      request = init;
      return jsonResponse({ phase: 'open', server_time: '1970-01-01T00:00:02.000Z' });
    }
  });

  const data = await api('/api/drops/drop-id');

  assert.equal(data.phase, 'open');
  assert.equal(request.headers.get('Authorization'), 'Bearer identity-token');
  assert.equal(serverNow(), 2000);
});

test('api sends the admin key and JSON mutation body', async t => {
  let request;
  installGlobals(t, {
    storage: { 'fd.admin': 'demo-admin-key' },
    fetchImpl: async (_path, init) => {
      request = init;
      return jsonResponse({ ok: true });
    }
  });

  await api('/api/admin/drops/drop-id/open', { method: 'POST', body: { note: 'demo' }, admin: true });

  assert.equal(request.headers.get('X-Admin-Key'), 'demo-admin-key');
  assert.equal(request.headers.get('Authorization'), null);
  assert.equal(request.headers.get('Content-Type'), 'application/json');
  assert.deepEqual(JSON.parse(request.body), { note: 'demo' });
});

test('api exposes error data and clears the identity token on 401', async t => {
  const { storageEntries } = installGlobals(t, {
    storage: { 'fd.jwt': 'expired-token' },
    fetchImpl: async () => jsonResponse({ error: 'unauthorized', message: 'Sign in again.' }, 401)
  });

  await assert.rejects(api('/api/drops/drop-id/me'), error => {
    assert.ok(error instanceof ApiError);
    assert.equal(error.status, 401);
    assert.equal(error.code, 'unauthorized');
    assert.deepEqual(error.data, { error: 'unauthorized', message: 'Sign in again.' });
    return true;
  });
  assert.equal(storageEntries.has('fd.jwt'), false);
});

test('api returns NDJSON as text without calling response.json', async t => {
  const ndjson = '{"entry_id":"one"}\n{"entry_id":"two"}\n';
  installGlobals(t, {
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      headers: new Headers({ 'Content-Type': 'application/x-ndjson' }),
      text: async () => ndjson,
      json() { assert.fail('NDJSON must not be parsed as JSON'); }
    })
  });

  assert.equal(await api('/api/drops/drop-id/snapshot'), ndjson);
});
