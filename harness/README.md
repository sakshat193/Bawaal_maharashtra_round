# Member 4 tools

Install the shared package with `pip install -e common` after Member 2 adds the Stage 0 package setup. From this checkout, the tools also find the source under `common/`.

## Attack harness

Set `ADMIN_KEY`, then run:

```bash
python -m harness http://localhost:8000 --profiles harness/profiles.yaml --out web/public/results.json
```

The harness creates naive FCFS, hardened FCFS, and WIL drops. It logs in each synthetic profile and submits the same users to all three drops. It seals each drop and waits for its Quicknet round. It then runs replay, forged redeem, double redeem, late payment, payment failure, and reconnect checks.

The harness calls `common.fairdrop_common.pow.solve` in a process pool when a drop requires proof-of-work. Use `--pow-bits`, `--workers`, and `--concurrency` to tune a local run. The payment test tier reserves offers for the adversarial payment checks. Fairness metrics include this tier.

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

