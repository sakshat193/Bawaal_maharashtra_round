# Offline verifier

Run the verifier from the repository root:

```bash
python verify/verify.py http://localhost:8000 <drop_id> --receipt receipt.json
```

The receipt option is optional. The verifier checks the published snapshot and exclusions hashes, their link, the timestamp date, both Quicknet relay responses, the ranking, and the round-0 allocation. It checks receipt membership and the Ed25519 signature when you provide a receipt file.

The timestamp check requires a proof payload and a `timestamped_at` value before round R. It does not claim that an OpenTimestamps proof has anchored in Bitcoin. The drand check compares both relays and checks SHA-256 of the signature. It does not verify the BLS signature.

