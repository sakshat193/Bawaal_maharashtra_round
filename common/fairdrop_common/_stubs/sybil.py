"""STUB for Member 4's sybil.py. Delete when the real one lands.

apply(rules, facts) -> [(entry_id, reason)] sorted by entry_id.

facts: one dict per entry that survived the proof-of-work check:
  {"entry_id": str, "device_hash": str|None, "payment_fingerprint": str|None,
   "account_age_s": int|None}
account_age_s is the account's age at the drop's opens_at, precomputed by the seal,
so the function needs no clock and stays pure. None means "unknown" and never fires.

An entry hit by several rules gets the reason of the first rule in `rules` order.
"""
from collections import defaultdict

KINDS = {"max_per_device": "device_hash", "max_per_payment": "payment_fingerprint", "min_account_age_s": None}


def apply(rules: list[dict], facts: list[dict]) -> list[tuple[str, str]]:
    for r in rules:
        if r.get("kind") not in KINDS:
            raise ValueError(f"unknown sybil rule kind: {r.get('kind')!r}")
    reason: dict[str, str] = {}
    for r in rules:
        kind = r["kind"]
        if kind == "min_account_age_s":
            hit = {f["entry_id"] for f in facts
                   if f.get("account_age_s") is not None and f["account_age_s"] < r["value"]}
        else:
            groups = defaultdict(list)
            for f in facts:
                v = f.get(KINDS[kind])
                if v is not None:
                    groups[v].append(f["entry_id"])
            hit = {eid for ids in groups.values() if len(ids) > r["limit"] for eid in ids}
        for eid in hit:
            reason.setdefault(eid, f"sybil:{r['id']}")
    return sorted(reason.items())
