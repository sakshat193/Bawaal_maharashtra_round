import { http, HttpResponse } from 'msw';
import { setupWorker } from 'msw/browser';
import { applyCreatedReceipt, createEntryResponse } from './mockEntries.js';
import { initialScenario, MOCK_SCENARIOS } from './scenarios.js';

export { MOCK_SCENARIOS };

const jsonFiles = import.meta.glob([
  '../../../contracts/fixtures/*.json',
  '!../../../contracts/fixtures/results.json'
], {
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

export const ERROR_FIXTURE_NAMES = Object.keys(json)
  .filter(name => json[name]?.error)
  .sort();

function getFixture(fixtures, name) {
  const fixture = fixtures[name];
  if (fixture === undefined) throw new Error(`Missing mock fixture: ${name}`);
  return fixture;
}

function queryScenario() {
  const hashQuery = globalThis.location?.hash?.split('?').slice(1).join('?') || '';
  const params = new URLSearchParams(hashQuery);
  return params.get('scenario') || new URLSearchParams(globalThis.location?.search || '').get('scenario');
}

let scenarioSeeded = false;
function currentScenario() {
  if (!scenarioSeeded) {
    const initial = initialScenario(sessionStorage.getItem('fd.scenario'), queryScenario(), MOCK_SCENARIOS);
    if (initial.seed) {
      sessionStorage.setItem('fd.scenario', initial.scenario);
      if (!sessionStorage.getItem('fd.jwt')) sessionStorage.setItem('fd.jwt', 'mock.identity.token');
    }
    scenarioSeeded = true;
  }
  const stored = sessionStorage.getItem('fd.scenario');
  return MOCK_SCENARIOS[stored] ? stored : 'none';
}

function setScenario(scenario) {
  sessionStorage.setItem('fd.scenario', MOCK_SCENARIOS[scenario] ? scenario : 'none');
}

function scenarioDropName(phase) {
  return `getDrop.200.${phase}.json`;
}

function scenarioMeName(scenario) {
  return `getMe.200.${MOCK_SCENARIOS[scenario].me}.json`;
}

function scenarioInvariantsName(phase) {
  if (phase === 'drawn' || phase === 'settled') return `getInvariants.200.${phase}.json`;
  return 'getInvariants.200.open.json';
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

function consumeNextError() {
  const requested = sessionStorage.getItem('fd.nextError');
  if (!requested) return null;
  sessionStorage.removeItem('fd.nextError');
  const name = json[requested]
    ? requested
    : ERROR_FIXTURE_NAMES.find(file => json[file].error === requested);
  if (!name) return null;
  const status = Number(name.match(/\.(\d{3})\./)?.[1]) || 400;
  return HttpResponse.json(getFixture(json, name), { status });
}

function injectedOrFixture(name, status) {
  return consumeNextError() || HttpResponse.json(getFixture(json, name), { status });
}

function dropForScenario() {
  const { drop } = MOCK_SCENARIOS[currentScenario()];
  return getFixture(json, scenarioDropName(drop));
}

export const worker = setupWorker(
  http.get('/api/drops', () => {
    const fixture = getFixture(json, 'listDrops.200.json');
    const phase = MOCK_SCENARIOS[currentScenario()].drop;
    return HttpResponse.json({
      ...fixture,
      drops: fixture.drops.map(drop => ({ ...drop, phase }))
    });
  }),
  http.get('/api/drops/:dropId', () => HttpResponse.json(dropForScenario())),
  http.post('/platform/login', () => HttpResponse.json(getFixture(json, 'login.200.json'))),
  http.get('/api/drops/:dropId/pow-challenge', () => HttpResponse.json(getFixture(json, 'getPowChallenge.200.json'))),
  http.post('/api/drops/:dropId/entries', async ({ request }) => {
    const error = consumeNextError();
    if (error) return error;
    const requestBody = await request.json();
    const response = createEntryResponse(getFixture(json, 'createEntry.201.json'), requestBody);
    setScenario('registered');
    return HttpResponse.json(response, { status: 201 });
  }),
  http.get('/api/drops/:dropId/snapshot', () => ndjsonResponse('getSnapshot')),
  http.get('/api/drops/:dropId/exclusions', () => ndjsonResponse('getExclusions')),
  http.get('/api/keys', () => HttpResponse.json(getFixture(json, 'getKeys.200.json'))),
  http.get('/api/drops/:dropId/me', ({ params }) => {
    const scenario = currentScenario();
    let me = getFixture(json, scenarioMeName(scenario));
    if (scenario === 'registered') {
      try {
        const receipt = JSON.parse(sessionStorage.getItem(`fd.receipt.${params.dropId}`) || 'null')?.receipt;
        me = applyCreatedReceipt(me, receipt);
      } catch {
        // Use the static registered fixture if this device has no saved receipt.
      }
    }
    return HttpResponse.json({ ...me, phase: MOCK_SCENARIOS[scenario].drop });
  }),
  http.get('/api/drops/:dropId/draw', () => HttpResponse.json(getFixture(json, 'getDraw.200.json'))),
  http.post('/api/offers/:offerId/redeem', () => {
    const error = consumeNextError();
    if (error) return error;
    setScenario('payment_pending');
    return HttpResponse.json(getFixture(json, 'redeemOffer.200.json'));
  }),
  http.post('/api/offers/:offerId/checkout', () =>
    injectedOrFixture('createPaymentCheckout.503.payment_unavailable.json', 503)
  ),
  http.post('/api/offers/:offerId/pay', async ({ request }) => {
    const error = consumeNextError();
    if (error) return error;
    const { result } = await request.json();
    const scenario = result === 'success' ? 'confirmed' : 'payment_failed';
    setScenario(scenario);
    const fixture = scenario === 'confirmed' ? 'payOffer.200.confirmed.json' : 'payOffer.200.payment_failed.json';
    return HttpResponse.json(getFixture(json, fixture));
  }),
  http.post('/api/offers/:offerId/decline', () => {
    const error = consumeNextError();
    if (error) return error;
    setScenario('declined');
    return HttpResponse.json(getFixture(json, 'declineOffer.200.json'));
  }),
  http.get('/api/drops/:dropId/invariants', () => {
    const { drop } = MOCK_SCENARIOS[currentScenario()];
    return HttpResponse.json(getFixture(json, scenarioInvariantsName(drop)));
  }),
  http.post('/api/admin/drops', () => {
    const error = consumeNextError();
    if (error) return error;
    setScenario('scheduled');
    return HttpResponse.json(getFixture(json, 'adminCreateDrop.201.json'), { status: 201 });
  }),
  http.post('/api/admin/drops/:dropId/open', () => {
    const error = consumeNextError();
    if (error) return error;
    setScenario('none');
    return HttpResponse.json(getFixture(json, 'adminOpen.200.json'));
  }),
  http.post('/api/admin/drops/:dropId/seal', () => {
    const error = consumeNextError();
    if (error) return error;
    setScenario('sealed');
    return HttpResponse.json(getFixture(json, 'adminSeal.200.json'));
  }),
  http.post('/api/admin/drops/:dropId/draw', () => {
    const error = consumeNextError();
    if (error) return error;
    setScenario('offered');
    return HttpResponse.json(getFixture(json, 'adminDraw.200.json'));
  }),
  http.get('/api/admin/drops/:dropId/outcomes', () => HttpResponse.json(getFixture(json, 'adminOutcomes.200.json'))),
  http.post('/api/admin/reset', () => {
    const error = consumeNextError();
    if (error) return error;
    setScenario('none');
    return HttpResponse.json(getFixture(json, 'adminReset.200.json'));
  })
);

export function start() {
  return worker.start({ onUnhandledRequest: 'bypass' });
}
