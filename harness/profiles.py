"""Expand the YAML profile list into deterministic synthetic users."""

from __future__ import annotations

from pathlib import Path

import ipaddress

import yaml


EXPECTED_PROFILES = {
    "honest_singles", "honest_groups", "speed_bots", "broker", "sybil_cluster",
    "replay", "forged_redeem", "double_redeem", "late_payer", "payment_failer", "reconnect",
}


def _ip(name: str, spec: dict, index: int) -> str | None:
    """Synthetic client address: `per_subnet` users share each /24 of `subnet_pool`. Local demo only."""
    if not spec.get("subnet_pool"):
        return None
    pool = ipaddress.ip_network(spec["subnet_pool"])
    per = max(1, int(spec.get("per_subnet", 1)))
    address = ipaddress.ip_address(int(pool.network_address) + (index // per) * 256 + index % per + 1)
    if address not in pool:
        raise ValueError(f"{name}: subnet_pool {pool} is too small for {index + 1} users")
    return str(address)


def load_users(path: Path) -> tuple[dict, list[dict]]:
    try:
        data = yaml.safe_load(path.read_text(encoding="utf-8"))
    except (OSError, yaml.YAMLError) as exc:
        raise ValueError(f"could not read profile file {path}: {exc}") from exc
    if not isinstance(data, dict) or data.get("version") != 1 or not isinstance(data.get("profiles"), dict):
        raise ValueError("profile file must have version: 1 and a profiles mapping")
    profiles = data["profiles"]
    missing = EXPECTED_PROFILES - profiles.keys()
    if missing:
        raise ValueError(f"profile file is missing: {', '.join(sorted(missing))}")

    users = []
    for name, spec in profiles.items():
        count = spec.get("count")
        quantity = spec.get("quantity")
        if isinstance(count, bool) or not isinstance(count, int) or count < 0:
            raise ValueError(f"{name}.count must be a non-negative integer")
        if isinstance(quantity, bool) or not isinstance(quantity, int) or not 1 <= quantity <= 4:
            raise ValueError(f"{name}.quantity must be between 1 and 4")
        for index in range(count):
            username = f"harness-{name}-{index:05d}"
            device_hash = spec.get("shared_device_hash", f"device-{name}-{index:05d}")
            payment = spec.get("shared_payment_fingerprint", f"payment-{name}-{index:05d}")
            users.append({
                "username": username,
                "profile": name,
                "profile_index": index,
                "quantity": quantity,
                "tier_id": spec.get("tier_id", "main"),
                "bot": bool(spec.get("bot", False)),
                "cohort": spec.get("cohort", name),
                "group_id": f"{name}-{index // max(1, int(spec.get('group_size', 1)))}" if spec.get("group_size") else None,
                "ip": _ip(name, spec, index),
                "arrival": spec.get("arrival", "normal"),
                "action": spec.get("action"),
                "risk": {
                    "device_hash": device_hash,
                    "payment_fingerprint": payment,
                    "account_age_days": int(spec.get("account_age_days", 365)),
                },
            })
    return profiles, users

