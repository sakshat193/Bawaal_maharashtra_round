# Fair Drop frontend

React and Vite screens driven by the allocation API, with deterministic fixtures
for offline development. The backend owns registration, ranking, inventory,
offers, deadlines and payment outcomes.

```powershell
npm --prefix frontend install
npm --prefix frontend run dev
npm --prefix frontend run build
```

The development server listens on port 5173. Routes use **HashRouter**:

| URL | Screen |
|---|---|
| `/#/` | Server drop listing and saved shows |
| `/#/drops/<id>` | Entry, registration, draw result and checkout |
| `/#/judges` | Harness results and live inventory invariants |
| `/#/demo` | Administrative demo controls |
| `/#/verify` or `/#/verify/<id>` | Published evidence; full verifier awaits M4 integration |

`?lite=1` disables 3D rendering. Reduced motion is respected by visualizations.

## Environment

Set these in `frontend/.env.local` or the process environment before running Vite:

| Variable | Meaning |
|---|---|
| `VITE_MSW=1` | Enable browser MSW fixtures; leave unset for the live API |
| `VITE_PROXY_TARGET` | Development proxy target for `/api` and `/platform`; default `http://localhost:8000` |
| `VITE_TURNSTILE_SITEKEY` | Public Turnstile site key; default is Cloudflare's demo test key |

Example offline start in PowerShell:

```powershell
$env:VITE_MSW = '1'
npm --prefix frontend run dev
```

Mock scenarios can be seeded with `/#/drops/<id>?scenario=payment_pending`.
The demo panel lists scenarios and error fixtures. Stored scenario changes survive
reload. MSW checkout defaults to `503 payment_unavailable`, hiding Razorpay for
the browser session while keeping **Succeed payment** and **Fail payment**.

Real optional Razorpay test checkout requires the API's test credentials. The
browser receives only its public key and order data; secrets belong on the server.
If a pending payment has no locally stored order ID, resume on the device where
Buy was pressed. M3 must expose the persisted order ID in authenticated `/me` to
enable broader recovery. Accepted receipts survive storage errors in memory;
reload recovery still needs functioning storage or a server receipt API.

## Contracts and checks

`npm --prefix frontend run gen:api` needs `contracts/openapi.yaml` from **M2**'s
branch. The command is unchanged. Integration must include M3's updated draw,
invariants and checkout schemas before generated types can prove those contracts.

```powershell
$reviewTests = @(rg --files frontend/src -g '*.test.js')
node --test @reviewTests
node --test contracts/fixtures/gen.test.mjs
npm --prefix frontend run build
node --test docs/adversarial/frontend-gates.test.mjs
```

The dashboard accepts M4's `results.json` array schema. Only `source: live_harness`
is labeled as a real harness run; examples and fallback fixtures are illustrative.
Missing or invalid results explain why the fixture is shown. Unknown bot labels
remain neutral. Harness attack checks are shown only when supplied.

<!-- The reviewed baseline main bundle was about 755 kB; bundle splitting is deferred. -->
