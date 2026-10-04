# Member 4 tools

Install the shared package and the API requirements with `pip install -e common -r api/requirements.txt` before running the tools.

## Attack harness

Set `ADMIN_KEY`, then run:

```bash
python -m harness http://localhost:8000 --profiles harness/profiles.yaml --out frontend/public/results.json
```

The harness creates naive FCFS, hardened FCFS, and WIL drops. It logs in each synthetic profile and submits the same users to all three drops. It seals each drop and waits for its Quicknet round. It then runs replay, forged redeem, double redeem, late payment, payment failure, and reconnect checks.

The harness calls `common.fairdrop_common.pow.solve` in a process pool when a drop requires proof-of-work. Use `--pow-bits`, `--workers`, and `--concurrency` to tune a local run. The payment test tier reserves offers for the adversarial payment checks. Fairness metrics include this tier.

The default demo run uses 4 PoW bits, 16 sub-puzzles and 2048 KiB per puzzle. Each mode opens its own 180-second registration window when its population gets the workers. Each mode draws and runs its attacks at its own committed round, so its offers cannot expire waiting for another mode. Higher difficulty needs enough workers to finish before the published close; a late entry fails the run. The configured values are public in each created drop. Published exclusions are checked against their canonical bytes, SHA-256 header and frozen Sybil rules before reporting rule counts.

## Fixture server

Run the fixture server with:

```bash
uvicorn harness.fixture_app:app --host 127.0.0.1 --port 8000
```

The server maps HTTP routes to `contracts/fixtures/<operationId>.<status>[.<variant>].json`. The query `?scenario=offered` selects `getMe.200.offered.json`. The fixture files remain owned by Member 1.

## Offline simulation

Run the seeded simulation with:

```bash
python -m harness.simulation --trials 250 --out harness/offline-simulation.json --svg harness/offline-simulation.svg
```

The simulation compares an unweighted individual lottery, WIL, and FCFS. It reports broker ticket share and the win rates for groups and singles. Each person in a friend group enters as an individual with quantity one.

