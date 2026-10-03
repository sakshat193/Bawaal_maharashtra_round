import { http, HttpResponse } from 'msw';
import { setupWorker } from 'msw/browser';

const jsonFiles = import.meta.glob('../../../contracts/fixtures/*.json', {
  eager: true,
  import: 'default'
});
const ndjsonFiles = import.meta.glob('../../../contracts/fixtures/*.ndjson', {
  eager: true,
  query: '?raw',
  import: 'default'
});

const byName = files => Object.fromEntries(
  Object.entries(files).map(([file, value]) => [file.slice(file.lastIndexOf('/') + 1), value])
);
const json = byName(jsonFiles);
const ndjson = byName(ndjsonFiles);

function getFixture(fixtures, name) {
  const fixture = fixtures[name];
  if (fixture === undefined) throw new Error(`Missing mock fixture: ${name}`);
  return fixture;
}

function ndjsonResponse(operation) {
  const responseHeaders = getFixture(json, `${operation}.200.headers.json`);
  return new HttpResponse(getFixture(ndjson, `${operation}.200.ndjson`), {
    status: 200,
    headers: {
      'Content-Type': 'application/x-ndjson',
      ...responseHeaders
    }
  });
}

export const worker = setupWorker(
  http.get('/api/drops', () => HttpResponse.json(getFixture(json, 'listDrops.200.json'))),
  http.get('/api/drops/:dropId', () => HttpResponse.json(getFixture(json, 'getDrop.200.json'))),
  http.get('/api/drops/:dropId/invariants', () => HttpResponse.json(getFixture(json, 'getInvariants.200.json'))),
  http.get('/api/drops/:dropId/snapshot', () => ndjsonResponse('getSnapshot')),
  http.get('/api/drops/:dropId/exclusions', () => ndjsonResponse('getExclusions')),
  http.get('/api/keys', () => HttpResponse.json(getFixture(json, 'getKeys.200.json')))
);

export function start() {
  return worker.start({ onUnhandledRequest: 'bypass' });
}
