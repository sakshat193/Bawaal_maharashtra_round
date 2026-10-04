"""Public evidence: snapshot and exclusions byte for byte, and the receipt public key."""
import base64
import uuid

from fastapi import APIRouter, Response

from fairdrop_common import crypto

from ..db import get_pool
from ..errors import ApiError
from ..timefmt import iso_s
from .keys import get_keys

router = APIRouter(tags=["evidence"])

IMMUTABLE = "public, max-age=31536000, immutable"
EXPOSE = ("X-Fairdrop-Snapshot-Sha256, X-Fairdrop-Exclusions-Sha256, X-Fairdrop-Sealed-At, "
          "X-Fairdrop-Timestamped-At, X-Fairdrop-Timestamp-Proof")


def _snapshot(drop_id):
    with get_pool().connection() as conn:
        snap = conn.execute("SELECT * FROM snapshots WHERE drop_id=%s", (drop_id,)).fetchone()
    if snap is None:
        raise ApiError(404, "not_found", "this drop has not been sealed yet")
    return snap


def _headers(snap: dict) -> dict:
    h = {"X-Fairdrop-Snapshot-Sha256": snap["canonical_hash"],
         "X-Fairdrop-Exclusions-Sha256": snap["exclusions_hash"],
         "X-Fairdrop-Sealed-At": iso_s(snap["sealed_at"]),
         "Access-Control-Expose-Headers": EXPOSE,
         # Immutable only once the timestamp exists; before that the proof headers can still appear.
         "Cache-Control": IMMUTABLE if snap["timestamp_proof"] else "public, max-age=2"}
    if snap["timestamp_proof"]:
        h["X-Fairdrop-Timestamped-At"] = iso_s(snap["timestamped_at"])
        h["X-Fairdrop-Timestamp-Proof"] = base64.b64encode(snap["timestamp_proof"].encode()).decode("ascii")
    return h


@router.get("/api/drops/{drop_id}/snapshot")
def get_snapshot(drop_id: uuid.UUID):
    snap = _snapshot(drop_id)
    return Response(bytes(snap["canonical_blob"]), media_type="application/x-ndjson", headers=_headers(snap))


@router.get("/api/drops/{drop_id}/exclusions")
def get_exclusions(drop_id: uuid.UUID):
    snap = _snapshot(drop_id)
    return Response(bytes(snap["exclusions_blob"]), media_type="application/x-ndjson", headers=_headers(snap))


@router.get("/api/keys")
def get_public_keys(response: Response):
    k = get_keys().receipt
    response.headers["Cache-Control"] = IMMUTABLE
    return {"receipt": {"alg": "Ed25519", "kid": crypto.key_id(k),
                        "public_key": base64.b64encode(crypto.public_raw(k)).decode("ascii")}}
