"""Offline comparison of unweighted lottery, WIL, and FCFS."""

from __future__ import annotations

import argparse
import hashlib
import json
import random
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
from statistics import mean

try:
    from fairdrop_common.rank import digest, fcfs_order, lottery_order
except ModuleNotFoundError:
    sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "common"))
    from fairdrop_common.rank import digest, fcfs_order, lottery_order


DROP_ID = "22222222-2222-4222-8222-222222222222"
MODES = ("individual_lottery", "weighted_individual_lottery", "fcfs")


def scenario(seed: int) -> list[dict]:
    rng = random.Random(seed)
    opened = datetime(2026, 10, 4, tzinfo=timezone.utc)
    humans = [("single", i, 1) for i in range(500)] + [("group", i, 1) for i in range(500)]
    rng.shuffle(humans)
    entries = []
    for i in range(99):
        entries.append({
            "entry_id": f"{i + 1:032x}", "quantity": 4, "tier_id": "main",
            "accepted_at": (opened + timedelta(microseconds=i)).isoformat().replace("+00:00", "Z"),
            "cohort": "broker", "bot": True,
        })
    for position, (cohort, index, quantity) in enumerate(humans):
        entries.append({
            "entry_id": f"{100 + position:032x}", "quantity": quantity, "tier_id": "main",
            "accepted_at": (opened + timedelta(seconds=1, microseconds=position)).isoformat().replace("+00:00", "Z"),
            "cohort": cohort, "bot": False, "group_id": f"friends-{index // 5}" if cohort == "group" else None,
        })
    return entries


def _individual_order(entries: list[dict], randomness: str) -> list[dict]:
    return sorted(entries, key=lambda entry: (-digest(DROP_ID, randomness, entry["entry_id"]), entry["entry_id"]))


def _allocate(order: list[dict], capacity: int) -> list[dict]:
    remaining = capacity
    selected = []
    for entry in order:
        if entry["quantity"] <= remaining:
            selected.append(entry)
            remaining -= entry["quantity"]
    return selected


def simulate(trials: int = 250, capacity: int = 500, seed: int = 20261004) -> dict:
    if trials < 1 or capacity < 1:
        raise ValueError("trials and capacity must be positive")
    entries = scenario(seed)
    identities = len(entries)
    broker_identities = sum(entry["cohort"] == "broker" for entry in entries)
    human_identities = identities - broker_identities
    trial_values = {mode: [] for mode in MODES}

    for trial in range(trials):
        randomness = hashlib.sha256(f"fairdrop-simulation:{seed}:{trial}".encode()).hexdigest()
        orders = {
            "individual_lottery": _individual_order(entries, randomness),
            "weighted_individual_lottery": lottery_order(entries, DROP_ID, randomness),
            "fcfs": fcfs_order(entries),
        }
        for mode, order in orders.items():
            winners = _allocate(order, capacity)
            ticket_total = sum(row["quantity"] for row in winners)
            broker_tickets = sum(row["quantity"] for row in winners if row["cohort"] == "broker")
            singles = sum(row["cohort"] == "single" for row in winners)
            grouped = sum(row["cohort"] == "group" for row in winners)
            trial_values[mode].append({
                "tickets_won": ticket_total,
                "broker_tickets": broker_tickets,
                "single_entries_won": singles,
                "group_entries_won": grouped,
            })

    modes = {}
    for mode, values in trial_values.items():
        tickets = mean(row["tickets_won"] for row in values)
        broker_tickets = mean(row["broker_tickets"] for row in values)
        single_wins = mean(row["single_entries_won"] for row in values)
        group_wins = mean(row["group_entries_won"] for row in values)
        modes[mode] = {
            "entries": identities,
            "identities": identities,
            "tickets_won": round(tickets, 2),
            "broker_ticket_share": round(broker_tickets / tickets if tickets else 0, 5),
            "broker_identity_share": round(broker_identities / identities, 5),
            "broker_share_ratio": round((broker_tickets / tickets) / (broker_identities / identities), 3) if tickets else 0,
            "single_win_rate": round(single_wins / 500, 5),
            "group_member_win_rate": round(group_wins / 500, 5),
            "groups_vs_singles": round(group_wins / single_wins, 3) if single_wins else 0,
            "trials": trials,
        }
    return {
        "schema_version": 1,
        "scenario": "500 honest singles, 500 friends entering individually, 99 brokers with quantity 4",
        "seed": seed,
        "capacity": capacity,
        "modes": modes,
    }


def _svg(data: dict) -> str:
    width, height = 820, 410
    labels = [("Individual lottery", "individual_lottery"), ("Weighted individual lottery", "weighted_individual_lottery"), ("FCFS", "fcfs")]
    colors = ("#f59e0b", "#22d3ee", "#a78bfa")
    bars = []
    for index, ((label, key), color) in enumerate(zip(labels, colors)):
        x = 210 + index * 190
        metrics = data["modes"][key]
        ticket_share = metrics["broker_ticket_share"] * 100
        group_ratio = metrics["groups_vs_singles"]
        bar_height = ticket_share * 2.25
        bars.append(f'<rect x="{x}" y="{300 - bar_height:.1f}" width="62" height="{bar_height:.1f}" fill="{color}"/>')
        bars.append(f'<text x="{x + 31}" y="{285 - bar_height:.1f}" text-anchor="middle" fill="#f4f4f5" font-size="16">{ticket_share:.1f}%</text>')
        bars.append(f'<text x="{x + 31}" y="330" text-anchor="middle" fill="#d4d4d8" font-size="13">{label}</text>')
        bars.append(f'<text x="{x + 31}" y="355" text-anchor="middle" fill="#a1a1aa" font-size="12">group/single {group_ratio:.2f}×</text>')
    return f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {width} {height}" role="img" aria-labelledby="title description">
<title id="title">Offline Fair Drop attack simulation</title><desc id="description">Average broker ticket share over {data['modes']['fcfs']['trials']} seeded trials. Groups enter individually alongside singles.</desc>
<rect width="100%" height="100%" fill="#09090b"/><text x="32" y="42" fill="#fafafa" font-size="22" font-family="sans-serif">Offline allocation comparison</text>
<text x="32" y="68" fill="#a1a1aa" font-size="13" font-family="sans-serif">Broker share of allocated tickets · {data['modes']['fcfs']['trials']} trials · {data['capacity']} ticket capacity</text>
<line x1="150" y1="300" x2="780" y2="300" stroke="#52525b"/><line x1="150" y1="75" x2="150" y2="300" stroke="#52525b"/>
<text x="30" y="186" transform="rotate(-90 30 186)" fill="#a1a1aa" font-size="12" font-family="sans-serif">Broker ticket share (%)</text>
<text x="118" y="304" text-anchor="end" fill="#a1a1aa" font-size="11">0</text><text x="118" y="191" text-anchor="end" fill="#a1a1aa" font-size="11">50</text><text x="118" y="79" text-anchor="end" fill="#a1a1aa" font-size="11">100</text>
<line x1="150" y1="187.5" x2="780" y2="187.5" stroke="#3f3f46" stroke-dasharray="4 5"/>{''.join(bars)}
<text x="32" y="393" fill="#71717a" font-size="11" font-family="sans-serif">Scenario: 9% broker identities, quantity 4; 1,000 honest identities, quantity 1.</text></svg>'''


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--trials", type=int, default=250)
    parser.add_argument("--capacity", type=int, default=500)
    parser.add_argument("--seed", type=int, default=20261004)
    parser.add_argument("--out", type=Path, default=Path("harness/offline-simulation.json"))
    parser.add_argument("--svg", type=Path, default=Path("harness/offline-simulation.svg"))
    args = parser.parse_args()
    data = simulate(args.trials, args.capacity, args.seed)
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")
    args.svg.parent.mkdir(parents=True, exist_ok=True)
    args.svg.write_text(_svg(data), encoding="utf-8")
    print(f"Wrote {args.out} and {args.svg}")
    for mode, result in data["modes"].items():
        print(f"{mode}: broker share {result['broker_ticket_share']:.1%}; group/single {result['groups_vs_singles']:.2f}x")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

