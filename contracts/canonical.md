# Canonical Fair Drop bytes

This document defines the bytes used by the server, the offline verifier, and the browser verifier. The Python implementation is `common/fairdrop_common/canonical.py`; the cross-language examples are in `contracts/vectors/`.

## JSON and timestamps

Canonical JSON uses UTF-8, sorted object keys, compact separators `,` and `:`, and `ensure_ascii=true`. JSON numbers are integers; floating-point values are rejected. Booleans and null are JSON values, not numbers. There is no byte-order mark.

All timestamps include a UTC offset and are normalized to UTC with a trailing `Z`. Drop configuration timestamps use whole seconds. `accepted_at` uses exactly six fractional digits, preserving microseconds. Python 3.10-compatible parsing replaces a terminal `Z` with `+00:00` before calling `datetime.fromisoformat`.

## Configuration

`config_bytes(drop, tiers)` encodes one canonical JSON object containing every drop field except `phase` and `config_hash`, plus `tiers`. Tiers are sorted by `tier_id`; their mutable `held` and `general_sale_units` fields are omitted. Drop timestamps are normalized to whole seconds. The configuration hash is lowercase hex SHA-256 of these bytes. Sybil rules are part of the config and therefore committed before entries arrive.

## Exclusions

`entry_id` is 32 lowercase hexadecimal characters. `exclusions_bytes(rows)` emits one canonical JSON object per excluded entry, containing only `entry_id` and `reason`, sorted by `entry_id`. Each object is followed by `\n`, including the final object. The empty exclusion set is the empty byte string. Its hash is lowercase hex SHA-256 of the entire blob.

## Snapshot

`snapshot_bytes(header, entries)` emits a canonical header followed by canonical eligible-entry rows, each followed by `\n`. The header has exactly these fields: `config_hash`, `drand_round`, `drop_id`, `exclusions_hash`, and `version`, whose fixed value is `fairdrop-snapshot/2`. `drop_id` is a UUID string. `drand_round` is a positive integer. Both hashes are 64 lowercase hexadecimal characters. Eligible rows contain exactly `accepted_at`, `entry_id`, `quantity`, and `tier_id`, sorted by `entry_id`. Each entry ID has 32 lowercase hexadecimal characters. `quantity` is an integer from 1 to 4. `accepted_at` has six fractional digits. The final line also ends in `\n`. The snapshot hash is lowercase hex SHA-256 of the whole blob; the header commits the exclusions hash as well.

`parse_snapshot(blob)` rejects invalid JSON, a missing final newline, unknown fields, a different version, or bytes that do not round-trip to the canonical encoding. It returns `(header, entries)`.

## Ranking

For drop UUID `D`, 32-byte drand randomness `r`, and 16-byte entry ID `e` (hex decoded):

```text
U = int(SHA256(b"fairdrop/rank/v1\0" + D.bytes + r + e), big-endian)
if U == 0: U = 1
K = U**quantity << (256 * (4 - quantity))
```

WIL sorts `K` descending and breaks ties with `entry_id` ascending. FCFS sorts `accepted_at` ascending, then `entry_id` ascending. Neither order uses floating-point arithmetic.

## Sybil rules

`apply(rules, facts)` supports only `max_per_device`, `max_per_payment`, and `min_account_age_s`. A group over a `limit` is excluded in full; missing group values are not treated as a shared value. The age rule compares `account_created_at` against the drop's `opens_at` and excludes an unknown creation time. Supply the shared opening timestamp as `{"opens_at": ..., "entries": [...]}` or on each entry. Unknown kinds and invalid rule values raise `ValueError`. When several rules match an entry, its first matching rule in the committed rule order supplies the reason. The result contains one `(entry_id, "sybil:<rule_id>")` pair per entry, sorted by entry ID.

## Receipts

`receipt_bytes(receipt)` is canonical JSON of the complete receipt object, with `accepted_at` normalized to six fractional digits. The receipt signature is Ed25519 over these exact bytes; the signature itself is not part of the signed object.

