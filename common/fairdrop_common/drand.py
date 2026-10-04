import asyncio
import hashlib
import json
import math
from datetime import datetime
from urllib.error import HTTPError, URLError
from urllib.request import urlopen

DRAND_CHAIN_HASH = "52db9ba70e0cc0f6eaf7803dd07447a1f5477735fd3f661792ba94600c84e971"
CHAIN = DRAND_CHAIN_HASH
DRAND_RELAYS = (
    f"https://api.drand.sh/{DRAND_CHAIN_HASH}/public",
    f"https://drand.cloudflare.com/{DRAND_CHAIN_HASH}/public",
)
GENESIS = 1692803367
PERIOD = 3


def round_at(timestamp: int | datetime) -> int:
    """Return the first Quicknet round whose due time is at or after timestamp."""
    if isinstance(timestamp, datetime):
        timestamp = math.ceil(timestamp.timestamp())
    if timestamp <= GENESIS:
        return 1
    return 1 + (timestamp - GENESIS + PERIOD - 1) // PERIOD


def time_of(round_number: int) -> int:
    if round_number < 1:
        raise ValueError("round_number must be positive")
    return GENESIS + (round_number - 1) * PERIOD


async def fetch(round_number: int) -> dict[str, object]:
    if round_number < 1:
        raise ValueError("round_number must be positive")

    def request(relay: str) -> dict[str, object]:
        with urlopen(f"{relay}/{round_number}", timeout=10) as response:
            payload = json.load(response)
        if not isinstance(payload, dict) or payload.get("round") != round_number:
            raise ValueError("drand returned an unexpected round")
        signature = payload.get("signature")
        randomness = payload.get("randomness")
        if not isinstance(signature, str) or not isinstance(randomness, str):
            raise ValueError("drand response is missing signature or randomness")
        try:
            signature_bytes = bytes.fromhex(signature)
            randomness_bytes = bytes.fromhex(randomness)
        except ValueError as exc:
            raise ValueError("drand response contains invalid hex") from exc
        if hashlib.sha256(signature_bytes).digest() != randomness_bytes:
            raise ValueError("drand randomness does not match its signature")
        return payload

    while True:
        try:
            first, second = await asyncio.gather(
                asyncio.to_thread(request, DRAND_RELAYS[0]),
                asyncio.to_thread(request, DRAND_RELAYS[1]),
            )
        except HTTPError as exc:
            # A round that is not yet published is expected; wait for this exact round.
            if exc.code == 404:
                await asyncio.sleep(1)
                continue
            raise
        except URLError:
            await asyncio.sleep(1)
            continue

        if first["signature"] != second["signature"]:
            raise ValueError("drand relays disagree on the requested round")
        if first["randomness"] != second["randomness"]:
            raise ValueError("drand relays disagree on the requested randomness")
        return first
