# Member 2: entry and identity

The rule this module follows: every entry acknowledged to a client must appear in the sealed set, and nothing accepted after the seal may.

## Run it

```bash
docker compose up -d postgres                 # Postgres 16 on localhost:5433
python -m venv .venv && .venv/Scripts/pip install -r api/requirements.txt -e ./common
.venv/Scripts/python scripts/gen_keys.py      # once; existing keys are never overwritten
cd api && ../.venv/Scripts/python -m app.migrate
ADMIN_KEY=dev-admin-key-change-me DEMO_MODE=true ../.venv/Scripts/python -m uvicorn app.main:app --port 8000
../.venv/Scripts/python -m pytest -q          # creates its own fairdrop_test database
RACE_REPEAT=100 ../.venv/Scripts/python -m pytest -q tests/test_race.py   # done-criterion
```

`docker compose up --build` runs the whole stack: postgres, keys, migrate, api and web. `keys` and `migrate` reuse the one `fairdrop-api:dev` image.

After `POST /api/admin/reset`, the demo drop opens about 10 s later through the scheduler. Its settings: Turnstile with Cloudflare test keys, PoW at 4 bits with 16 sub-puzzles of 2 MiB, Sybil limit 2 per device and per card, a minimum account age of 1 day, a 60 s offer TTL, a 30 s payment window and 3 promotion rounds.

## What lives where

| File | What |
|---|---|
| `contracts/schema.sql`, `contracts/openapi.yaml`, `common/fairdrop_common/enums.py` | Stage 0 contracts, frozen |
| `common/fairdrop_common/pow.py` | Argon2id puzzle: `challenge`, `solve` (the harness imports this), `verify`, `verify_entry` |
| `common/fairdrop_common/crypto.py` | key loading, `sign_receipt`, `verify_receipt` |
| `common/fairdrop_common/_stubs/` | throwaway stand-ins for `canonical`, `sybil` (Member 4) and `drand` (Member 3); `_compat.py` picks up the real modules automatically when they land |
| `api/app/entry/platform.py` | `POST /platform/login`, **`current_identity()`** |
| `api/app/entry/drops.py` | admin create/open, public list/detail |
| `api/app/entry/entries.py` | `/pow-challenge`, `/entries` (Turnstile, then the shared fence, then insert, then the signed receipt) |
| `api/app/entry/seal.py` | close, PoW, Sybil, publish, timestamp, guard; resumable and idempotent |
| `api/app/entry/timestamp.py` | OpenTimestamps calendars + optional public git commit |
| `api/app/entry/scheduler.py` | opens at `opens_at` and seals at `closes_at`; retries a failed timestamp |
| `api/app/entry/evidence.py` | `/snapshot`, `/exclusions`, `/keys` |
| `frontend/src/pow/` | `solvePow(params, onProgress, signal)` Web Worker (hash-wasm) |
| `scripts/seed_entries.py` | `--n 50000 [--drop id] [--sybil 40]` inserts and seals |

## Handoff notes

**Member 3**
- Private routes take `Depends(current_identity)` from `app.entry` and get back an `Identity(identity_id, account_created_at, device_hash, payment_fingerprint)`.
- In tests, set `app.dependency_overrides[current_identity] = lambda: Identity("id_x", None, None, None)`.
- Draw precondition: `app.entry.seal.snapshot_drawable(snapshot_row, drop_row)`. It is true only when a timestamp proof exists and `timestamped_at < time_of(R)`.
- `main.py` mounts `app.alloc.router` automatically once `api/app/alloc/__init__.py` exports `router`.
- To get a 50k sealed drop: `python scripts/seed_entries.py --n 50000`. Round R is due about 2 minutes after the seal.

**Member 4: please confirm these calling conventions**
- Every argument I pass to `canonical.*` is already JSON-ready: UUIDs are strings and timestamps are `Z` strings. `accepted_at` always has 6 microsecond digits.
- `exclusions_bytes(rows)` gets a list of `(entry_id, reason)` tuples.
- `snapshot_bytes(header, entries)` gets a header without `version`; the stub adds it.
- `sybil.apply(rules, facts)`: each fact is `{entry_id, device_hash, payment_fingerprint, account_age_s}`. `account_age_s` is the account's age at `opens_at`, precomputed so the function stays pure. `None` never fires a rule. When several rules hit one entry, the first rule in `rules` order wins.
- The seal runs Sybil rules only on entries whose proof-of-work passed.
- Harness: log in with `DEMO_MODE=true` and pass `device_hash`, `payment_fingerprint` and `account_age_days` in the body. Set `RATE_LIMIT_ENABLED=false`, or every bot behind one address gets 429.

**Member 1**
- `import { solvePow } from './pow'`. Pass it the `/pow-challenge` response.
- Persist `nonces` from `onProgress`, keyed by drop and `issued_at`. Resume after a tab suspension with `{...params, startIndex, prior}`.
- Submit `{pow: {issued_at, nonces}}` with the same `issued_at`.
- `/snapshot` and `/exclusions` return the raw bytes. The hashes and the base64 timestamp proof come in `X-Fairdrop-*` headers, which CORS exposes.
- Errors always look like `{error, message}`.

## Decisions made while building (please review)

- **Missing PoW is rejected at entry (422), not accepted and then excluded.** An honest person whose worker failed learns now, not after the draw. A proof with the right shape but wrong values is still accepted and excluded at the seal as `pow_invalid`.
- **Generic HTTP errors** (`unauthorized`, `invalid_request`, `not_found`, `rate_limited`, `conflict`) are a separate `TransportError` enum, so the frozen `ErrorCode` list is unchanged.
- **Snapshot `entry_count`** is the number of eligible entries, which equals the number of lines in the snapshot.
- **`identity_id`** is `"id_" + HMAC(raw platform private key, username)[:16]`, and the JWT `sub` equals `identity_id`.
- **Timestamps:** every configured backend must succeed before the seal counts as stamped. If stamping fails, the guard blocks the draw. The scheduler, or `POST /admin/drops/{id}/seal`, retries until round R is due.

## Measured so far

| What | Time |
|---|---|
| Desktop Chromium solve (bits 4, k 16, 2 MiB) | ~1.0 s (2.8 ms per Argon2id call) |
| One server core, same puzzle | 0.5 s (1.4 ms per call) |
| Verify one entry at the seal | ~22 ms per core |
| Cheapest phone | **TODO**: open the entry form on the cheapest phone you can borrow and record it here |

**The seal has to beat round R.** Verifying 50,000 PoW entries takes about 1,100 core-seconds, roughly 2–3 minutes on 8 cores. The default 120-second `DRAND_MARGIN_S` does not cover that.

- For a large PoW drop, raise `DRAND_MARGIN_S`, or lower `pow_k` or `pow_memory_kib`.
- Demo-size drops (hundreds of entries) seal in seconds.
- Seeded drops don't need PoW (`pow_required=false`).

## Git timestamp witness (`TIMESTAMP_BACKENDS=ots,git`)

Used for the laptop demo (docker-compose). Render stays `ots` only: its free filesystem is ephemeral.

1. Create a public GitHub repo and a fine-grained PAT limited to it (Contents: read and write). Never commit the token.
2. `git clone https://x-access-token:<PAT>@github.com/<org>/<repo>.git .timestamps` (or set `TIMESTAMP_GIT_HOST_DIR`).
3. In `.env`: `TIMESTAMP_BACKENDS=ots,git` and `TIMESTAMP_GIT_WEB_URL=https://github.com/<org>/<repo>`.
4. Preflight: `docker compose exec api git -C /timestamps push --dry-run`, then rehearse one seal.

Every backend must succeed, so a failed push blocks the draw until the scheduler retries.

