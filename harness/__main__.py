"""Command line entry point: python -m harness BASE_URL."""

from __future__ import annotations

import argparse
import asyncio
from pathlib import Path

from .runner import run_harness


def main() -> int:
    parser = argparse.ArgumentParser(description="Run the eleven-profile attack harness against three Fair Drop modes.")
    parser.add_argument("base_url", help="API origin, for example http://localhost:8000")
    parser.add_argument("--profiles", type=Path, default=Path("harness/profiles.yaml"))
    parser.add_argument("--out", type=Path, default=Path("frontend/public/results.json"))
    parser.add_argument("--workers", type=int, default=4)
    parser.add_argument("--concurrency", type=int, default=32)
    parser.add_argument("--pow-bits", type=int, default=8)
    args = parser.parse_args()
    if args.workers < 1 or args.concurrency < 1 or args.pow_bits < 0:
        parser.error("workers/concurrency must be positive and pow-bits cannot be negative")
    try:
        result = asyncio.run(run_harness(
            args.base_url, args.profiles, args.out, args.workers, args.concurrency, args.pow_bits
        ))
    except (ValueError, RuntimeError) as exc:
        parser.exit(1, f"FAIL  {exc}\n")
    for mode in result["modes"]:
        print(f"{mode['mode']}: {mode['tickets_won']} tickets; bot share {mode['bot_ticket_share']:.1%}; ratio {mode['bot_share_ratio']:.2f}x")
        for name, check in mode["attack_checks"].items():
            status = "PASS" if check["passed"] else "FAIL"
            print(f"  {status} {name}: {check['status']}")
    print(f"Wrote {args.out}")
    checks_pass = all(
        check["passed"] for mode in result["modes"] for check in mode["attack_checks"].values()
    )
    invariants_pass = all(
        mode["invariants"]["held_within_capacity"]
        and mode["invariants"]["held_matches_active_offers"]
        and mode["invariants"]["oversell"] == 0
        and mode["invariants"]["double_redemption"] == 0
        for mode in result["modes"]
    )
    return 0 if checks_pass and invariants_pass else 1


if __name__ == "__main__":
    raise SystemExit(main())

