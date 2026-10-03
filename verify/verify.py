"""Recompute a Fair Drop draw using only public API evidence."""

from __future__ import annotations

import argparse
import base64
import hashlib
import json
import sys
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urljoin

import httpx

try:
    from fairdrop_common.canonical import exclusions_bytes, parse_snapshot
    from fairdrop_common.rank import fcfs_order, lottery_order
except ModuleNotFoundError:
    sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "common"))
    from fairdrop_common.canonical import exclusions_bytes, parse_snapshot
    from fairdrop_common.rank import fcfs_order, lottery_order

try:
    from .receipts import verify_receipt
except ImportError:
    from receipts import verify_receipt


QUICKNET_CHAIN = "52db9ba70e0cc0f6eaf7803dd07447a1f5477735fd3f661792ba94600c84e971"
QUICKNET_GENESIS = 1692803367
QUICKNET_PERIOD = 3
RELAYS = ("https://api.drand.sh", "https://drand.cloudflare.com")


class VerificationError(Exception):
    pass


def _url(base_url: str, path: str) -> str:
    return urljoin(base_url.rstrip("/") + "/", path.lstrip("/"))


def _get_json(client: httpx.Client, url: str) -> dict:
    response = client.get(url)
    response.raise_for_status()
    try:
        value = response.json()
    except ValueError as exc:
        raise VerificationError(f"{url} did not return JSON") from exc
    if not isinstance(value, dict):
        raise VerificationError(f"{url} did not return a JSON object")
    return value


def _wire_blob(response: httpx.Response, names: tuple[str, ...], rows_key: str | None = None):
    response.raise_for_status()
    metadata = {key.lower(): value for key, value in response.headers.items()}
    content_type = response.headers.get("content-type", "").lower()
    if "json" not in content_type:
        return response.content, metadata
    try:
        payload = response.json()
    except ValueError as exc:
        raise VerificationError(f"{response.url} returned invalid JSON") from exc
    if not isinstance(payload, dict):
        raise VerificationError(f"{response.url} returned an unexpected JSON value")
    metadata.update(payload)
    for name in ("snapshot", "exclusions", "data"):
        if isinstance(payload.get(name), dict):
            metadata.update(payload[name])
            payload = {**payload, **payload[name]}
    for name in names:
        if isinstance(payload.get(name), str):
            if payload.get("encoding") == "base64":
                try:
                    return base64.b64decode(payload[name], validate=True), metadata
                except ValueError as exc:
                    raise VerificationError(f"{name} is not valid base64") from exc
            return payload[name].encode("utf-8"), metadata
        if isinstance(payload.get(name), list) and name.endswith("_lines"):
            return b"".join(
                (json.dumps(row, sort_keys=True, separators=(",", ":"), ensure_ascii=True) + "\n").encode()
                for row in payload[name]
            ), metadata
    for name in ("canonical_blob_base64", "snapshot_base64", "exclusions_base64", "blob_base64"):
        encoded = payload.get(name)
        if isinstance(encoded, str):
            try:
                return base64.b64decode(encoded, validate=True), metadata
            except ValueError as exc:
                raise VerificationError(f"{name} is not valid base64") from exc
    if rows_key and isinstance(payload.get(rows_key), list):
        rows = payload[rows_key]
        if rows_key == "exclusions":
            return exclusions_bytes(rows), metadata
    raise VerificationError(f"{response.url} did not include the requested canonical bytes")


def _meta(metadata: dict, *names: str):
    lower = {str(key).lower(): value for key, value in metadata.items()}
    for name in names:
        if name in metadata and metadata[name] not in (None, ""):
            return metadata[name]
        if name.lower() in lower and lower[name.lower()] not in (None, ""):
            return lower[name.lower()]
    return None


def _hex_hash(blob: bytes) -> str:
    return hashlib.sha256(blob).hexdigest()


def _exclusions(blob: bytes) -> list[dict]:
    if blob and not blob.endswith(b"\n"):
        raise VerificationError("exclusions blob is missing its final newline")
    rows = []
    try:
        rows = [json.loads(line) for line in blob.splitlines()]
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise VerificationError("exclusions blob contains invalid JSON") from exc
    if exclusions_bytes(rows) != blob:
        raise VerificationError("exclusions blob is not canonical")
    return rows


def _allocation_rows(draw: dict, eligible: list[dict]) -> list[dict]:
    raw = next((draw.get(key) for key in (
        "round_0_allocation", "initial_allocation", "allocation", "offers"
    ) if draw.get(key) is not None), None)
    if isinstance(raw, dict):
        for key in ("offers", "entries", "allocated"):
            if isinstance(raw.get(key), list):
                raw = raw[key]
                break
        else:
            raw = [
                {"entry_id": entry_id, "tier_id": tier_id}
                for tier_id, entry_ids in raw.items()
                for entry_id in (entry_ids if isinstance(entry_ids, list) else [])
            ]
    if not isinstance(raw, list):
        raise VerificationError("draw evidence is missing its round-0 allocation")
    by_id = {entry["entry_id"]: entry for entry in eligible}
    result = []
    for item in raw:
        entry_id = item if isinstance(item, str) else item.get("entry_id") if isinstance(item, dict) else None
        if entry_id not in by_id:
            raise VerificationError(f"draw allocation contains unknown entry {entry_id!r}")
        source = by_id[entry_id]
        result.append({
            "entry_id": entry_id,
            "tier_id": item.get("tier_id", source["tier_id"]) if isinstance(item, dict) else source["tier_id"],
            "quantity": item.get("quantity", source["quantity"]) if isinstance(item, dict) else source["quantity"],
        })
    return sorted(result, key=lambda row: row["entry_id"])


def _drand_round(client: httpx.Client, round_number: int, chain: str) -> dict:
    data = []
    for relay in RELAYS:
        url = f"{relay}/{chain}/public/{round_number}"
        try:
            data.append(_get_json(client, url))
        except (httpx.HTTPError, VerificationError) as exc:
            raise VerificationError(f"could not read drand round {round_number} from {relay}: {exc}") from exc
    for value in data:
        if int(value.get("round", -1)) != round_number:
            raise VerificationError(f"drand relay returned the wrong round for {round_number}")
        signature = value.get("signature")
        randomness = value.get("randomness")
        if not isinstance(signature, str) or not isinstance(randomness, str):
            raise VerificationError("drand response is missing signature or randomness")
        try:
            signature_bytes = bytes.fromhex(signature)
        except ValueError as exc:
            raise VerificationError("drand signature is not hexadecimal") from exc
        if hashlib.sha256(signature_bytes).hexdigest() != randomness.lower():
            raise VerificationError("drand randomness does not match SHA-256(signature)")
    if any((row.get("signature"), row.get("randomness")) != (data[0].get("signature"), data[0].get("randomness")) for row in data[1:]):
        raise VerificationError("the two drand relays disagree")
    return data[0]


def verify_drop(base_url: str, drop_id: str, receipt_path: Path | None = None) -> list[tuple[str, str]]:
    checks = []
    with httpx.Client(timeout=15.0, follow_redirects=True) as client:
        path = f"/api/drops/{drop_id}"
        drop = _get_json(client, _url(base_url, path))
        snapshot_response = client.get(_url(base_url, path + "/snapshot"))
        snapshot_blob, snapshot_meta = _wire_blob(
            snapshot_response, ("canonical_blob", "snapshot_blob", "snapshot", "blob")
        )
        exclusion_response = client.get(_url(base_url, path + "/exclusions"))
        exclusion_blob, exclusion_meta = _wire_blob(
            exclusion_response, ("exclusions_blob", "canonical_blob", "blob"), "exclusions"
        )
        draw = _get_json(client, _url(base_url, path + "/draw"))

        header, eligible = parse_snapshot(snapshot_blob)
        excluded = _exclusions(exclusion_blob)
        if header["drop_id"] != drop_id:
            raise VerificationError("snapshot belongs to a different drop")
        snapshot_hash = _hex_hash(snapshot_blob)
        exclusions_hash = _hex_hash(exclusion_blob)
        expected_snapshot_hash = _meta(snapshot_meta, "canonical_hash", "snapshot_hash", "x-snapshot-hash", "x-canonical-hash") or _meta(draw, "snapshot_hash", "canonical_hash")
        expected_exclusions_hash = _meta(exclusion_meta, "exclusions_hash", "x-exclusions-hash") or _meta(draw, "exclusions_hash") or header["exclusions_hash"]
        if not expected_snapshot_hash:
            raise VerificationError("API did not publish the snapshot hash")
        if snapshot_hash != str(expected_snapshot_hash).lower():
            raise VerificationError("snapshot hash does not match the published hash")
        checks.append(("snapshot SHA-256", "PASS"))
        if not expected_exclusions_hash:
            raise VerificationError("API did not publish the exclusions hash")
        if exclusions_hash != str(expected_exclusions_hash).lower():
            raise VerificationError("exclusions hash does not match the published hash")
        if header["exclusions_hash"] != exclusions_hash:
            raise VerificationError("snapshot header does not commit to the exclusions blob")
        checks.append(("exclusions SHA-256 and snapshot link", "PASS"))

        timestamp_proof = _meta(snapshot_meta, "timestamp_proof", "x-timestamp-proof")
        timestamped_at = _meta(snapshot_meta, "timestamped_at", "x-timestamped-at")
        if isinstance(timestamp_proof, str):
            try:
                decoded_proof = json.loads(timestamp_proof)
            except json.JSONDecodeError:
                decoded_proof = None
            if isinstance(decoded_proof, dict):
                timestamp_proof = decoded_proof
        if isinstance(timestamp_proof, dict):
            timestamped_at = timestamped_at or timestamp_proof.get("timestamped_at")
            proof_present = any(timestamp_proof.get(key) for key in (
                "ots_receipt", "ots_proof", "opentimestamps", "public_commit_url", "commit_url", "proof"
            ))
        else:
            proof_present = isinstance(timestamp_proof, str) and bool(timestamp_proof.strip())
        if not proof_present or not timestamped_at:
            raise VerificationError("snapshot is missing its timestamp proof or timestamped_at")
        round_number = int(header["drand_round"])
        if round_number < 1:
            raise VerificationError("snapshot has an invalid drand round")
        due_at = datetime.fromtimestamp(
            QUICKNET_GENESIS + (round_number - 1) * QUICKNET_PERIOD, timezone.utc
        )
        try:
            timestamp = datetime.fromisoformat(str(timestamped_at).replace("Z", "+00:00"))
        except ValueError as exc:
            raise VerificationError("timestamped_at is not a valid ISO-8601 timestamp") from exc
        if timestamp.tzinfo is None or timestamp.astimezone(timezone.utc) >= due_at:
            raise VerificationError("snapshot timestamp is not before the committed drand round")
        checks.append(("published timestamp predates round", f"PASS ({timestamped_at} < {due_at.isoformat().replace('+00:00', 'Z')})"))

        detail_round = int(drop.get("drand_round", round_number))
        draw_round = int(draw.get("drand_round", draw.get("round", round_number)))
        if detail_round != round_number or draw_round != round_number:
            raise VerificationError("drop, snapshot, and draw disagree on drand round")
        chain = drop.get("drand_chain", QUICKNET_CHAIN)
        if chain != QUICKNET_CHAIN:
            raise VerificationError("drop is not configured for the committed Quicknet chain")
        beacon = _drand_round(client, round_number, chain)
        if draw.get("signature") != beacon["signature"] or draw.get("randomness") != beacon["randomness"]:
            raise VerificationError("draw evidence does not match the two drand relays")
        checks.append(("drand relays and draw evidence", "PASS"))

        allocation_mode = drop.get("allocation_mode", draw.get("allocation_mode"))
        if allocation_mode == "fcfs":
            ranked = fcfs_order(eligible)
        elif allocation_mode == "lottery_wil":
            ranked = lottery_order(eligible, drop_id, beacon["randomness"])
        else:
            raise VerificationError(f"unknown allocation mode: {allocation_mode!r}")
        published_rank = draw.get("ranked_entry_ids", draw.get("ranked_entries"))
        if isinstance(published_rank, list):
            published_ids = [item if isinstance(item, str) else item.get("entry_id") for item in published_rank]
            if published_ids != [entry["entry_id"] for entry in ranked]:
                raise VerificationError("recomputed ranking does not match /draw")
            checks.append(("ranking", "PASS"))
        else:
            raise VerificationError("draw evidence is missing ranked_entry_ids")

        tiers = drop.get("tiers")
        if not isinstance(tiers, list) or not all(isinstance(tier, dict) and "capacity" in tier for tier in tiers):
            raise VerificationError("drop detail is missing tier capacities")
        remaining = {tier["tier_id"]: int(tier["capacity"]) for tier in tiers}
        expected_allocation = []
        for entry in ranked:
            capacity = remaining.get(entry["tier_id"])
            if capacity is None:
                raise VerificationError(f"snapshot uses unknown tier {entry['tier_id']!r}")
            if capacity >= int(entry["quantity"]):
                remaining[entry["tier_id"]] -= int(entry["quantity"])
                expected_allocation.append({
                    "entry_id": entry["entry_id"],
                    "tier_id": entry["tier_id"],
                    "quantity": int(entry["quantity"]),
                })
        expected_allocation.sort(key=lambda row: row["entry_id"])
        if _allocation_rows(draw, eligible) != expected_allocation:
            raise VerificationError("recomputed round-0 allocation does not match /draw")
        checks.append(("round-0 allocation", "PASS"))

        if receipt_path:
            known_ids = {row["entry_id"] for row in eligible} | {row["entry_id"] for row in excluded}
            verify_receipt(client, base_url, drop_id, receipt_path, known_ids)
            checks.append(("receipt membership and Ed25519 signature", "PASS"))
    return checks


def main() -> int:
    parser = argparse.ArgumentParser(description="Independently verify a Fair Drop snapshot and draw.")
    parser.add_argument("base_url", help="API origin, for example http://localhost:8000")
    parser.add_argument("drop_id", help="Drop UUID")
    parser.add_argument("--receipt", type=Path, help="optional entry response/receipt JSON file")
    args = parser.parse_args()
    try:
        checks = verify_drop(args.base_url, args.drop_id, args.receipt)
    except (VerificationError, httpx.HTTPError, ValueError, KeyError, TypeError) as exc:
        print(f"FAIL  {exc}")
        return 1
    for name, result in checks:
        print(f"{result:<5} {name}")
    print("PASS  Fair Drop evidence is internally consistent")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

