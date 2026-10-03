"""Deterministic, pre-committed Sybil exclusion rules."""

from __future__ import annotations

from collections import defaultdict
from collections.abc import Mapping
from datetime import timedelta

from .canonical import parse_ts


_MAX_RULES = {
    "max_per_device": "device_hash",
    "max_per_payment": "payment_fingerprint",
}


def _facts(value):
    if isinstance(value, Mapping):
        entries = value.get("entries")
        if entries is None:
            raise ValueError("facts mapping must contain an entries list")
        return list(entries), value.get("opens_at")
    return list(value), None


def _validate_rules(rules):
    validated = []
    for rule in rules:
        rule_id = rule.get("id")
        kind = rule.get("kind")
        if not isinstance(rule_id, str) or not rule_id:
            raise ValueError("every Sybil rule needs a non-empty id")
        if kind in _MAX_RULES:
            limit = rule.get("limit")
            if isinstance(limit, bool) or not isinstance(limit, int) or limit < 1:
                raise ValueError(f"rule {rule_id!r} limit must be a positive integer")
        elif kind == "min_account_age_s":
            limit = rule.get("value")
            if isinstance(limit, bool) or not isinstance(limit, int) or limit < 0:
                raise ValueError(f"rule {rule_id!r} value must be a non-negative integer")
        else:
            raise ValueError(f"unknown Sybil rule kind: {kind!r}")
        validated.append((rule_id, kind, limit))
    return validated


def apply(rules: list[dict], facts: list[dict] | dict) -> list[tuple[str, str]]:
    """Apply fixed rules and return sorted (entry_id, sybil:<rule_id>) pairs.

    For age rules, pass opens_at in the facts mapping or on each entry. If several
    rules exclude one entry, the first matching rule in the frozen config wins.
    """
    checked_rules = _validate_rules(rules)
    entries, shared_opens_at = _facts(facts)
    by_id = {}
    for entry in entries:
        entry_id = entry.get("entry_id")
        if not isinstance(entry_id, str) or not entry_id:
            raise ValueError("every fact row needs an entry_id")
        if entry_id in by_id:
            raise ValueError(f"duplicate entry_id in Sybil facts: {entry_id}")
        by_id[entry_id] = entry

    excluded = {}
    for rule_id, kind, limit in checked_rules:
        reason = f"sybil:{rule_id}"
        if kind in _MAX_RULES:
            field = _MAX_RULES[kind]
            groups = defaultdict(list)
            for entry_id, entry in by_id.items():
                value = entry.get(field)
                if value is not None and value != "":
                    groups[value].append(entry_id)
            for entry_ids in groups.values():
                if len(entry_ids) > limit:
                    for entry_id in entry_ids:
                        excluded.setdefault(entry_id, reason)
            continue

        for entry_id, entry in by_id.items():
            created_at = entry.get("account_created_at")
            opens_at = entry.get("opens_at", shared_opens_at)
            if opens_at is None:
                raise ValueError("min_account_age_s needs opens_at in the facts")
            if created_at is None:
                excluded.setdefault(entry_id, reason)
                continue
            age = parse_ts(opens_at) - parse_ts(created_at)
            if age < timedelta(seconds=limit):
                excluded.setdefault(entry_id, reason)

    return [(entry_id, excluded[entry_id]) for entry_id in sorted(excluded)]

