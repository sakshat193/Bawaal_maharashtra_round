import asyncio
import hashlib
import json
import unittest
from datetime import datetime, timezone
from unittest.mock import AsyncMock, patch
from urllib.error import HTTPError

from common.fairdrop_common import drand


class FakeResponse:
    def __init__(self, payload):
        self.payload = payload

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return None

    def read(self):
        return json.dumps(self.payload).encode("utf-8")


def beacon(round_number, signature="ab"):
    return {
        "round": round_number,
        "signature": signature,
        "randomness": hashlib.sha256(bytes.fromhex(signature)).hexdigest(),
    }


class DrandTimingTests(unittest.TestCase):
    def test_datetime_rounds_ceil_subseconds_and_export_chain(self):
        self.assertEqual(drand.CHAIN, drand.DRAND_CHAIN_HASH)
        for offset in (0, 0.1, 1, 3, 3.1, 17):
            timestamp = drand.GENESIS + offset
            value = datetime.fromtimestamp(timestamp, timezone.utc)
            round_number = drand.round_at(value)
            self.assertGreaterEqual(drand.time_of(round_number), timestamp)
            if round_number > 1:
                self.assertLess(drand.time_of(round_number - 1), timestamp)

    def test_round_at_returns_the_first_due_round(self):
        self.assertEqual(drand.round_at(drand.GENESIS - 1), 1)
        self.assertEqual(drand.round_at(drand.GENESIS), 1)
        self.assertEqual(drand.round_at(drand.GENESIS + 1), 2)
        self.assertEqual(drand.round_at(drand.GENESIS + 3), 2)
        self.assertEqual(drand.round_at(drand.GENESIS + 17), 7)

    def test_time_of_maps_rounds_to_genesis_intervals(self):
        self.assertEqual(drand.time_of(1), drand.GENESIS)
        self.assertEqual(drand.time_of(2), drand.GENESIS + 3)
        self.assertEqual(drand.time_of(6), drand.GENESIS + 15)
        with self.assertRaisesRegex(ValueError, "must be positive"):
            drand.time_of(0)


class DrandFetchTests(unittest.TestCase):
    def test_relays_receive_an_identifiable_user_agent(self):
        with patch.object(drand, "urlopen", return_value=FakeResponse(beacon(7))) as urlopen:
            asyncio.run(drand.fetch(7))
        for call in urlopen.call_args_list:
            request = call.args[0]
            self.assertEqual(request.get_header("User-agent"), "FairDrop/0.2.0")
            self.assertTrue(request.full_url.endswith("/7"))

    def test_fetch_requires_two_matching_valid_relays(self):
        payload = beacon(7)
        with patch.object(drand, "urlopen", return_value=FakeResponse(payload)) as urlopen:
            result = asyncio.run(drand.fetch(7))

        self.assertEqual(result, payload)
        self.assertEqual(urlopen.call_count, 2)

    def test_fetch_rejects_relay_disagreement(self):
        responses = [FakeResponse(beacon(7, "ab")), FakeResponse(beacon(7, "cd"))]
        with patch.object(drand, "urlopen", side_effect=responses):
            with self.assertRaisesRegex(ValueError, "relays disagree"):
                asyncio.run(drand.fetch(7))

    def test_fetch_rejects_randomness_that_does_not_hash_the_signature(self):
        invalid = {"round": 7, "signature": "ab", "randomness": "00" * 32}
        with patch.object(drand, "urlopen", return_value=FakeResponse(invalid)):
            with self.assertRaisesRegex(ValueError, "does not match"):
                asyncio.run(drand.fetch(7))

    def test_fetch_waits_for_the_requested_round(self):
        unavailable = HTTPError("https://example.invalid", 404, "not found", None, None)
        payload = beacon(7)
        responses = [unavailable, unavailable, FakeResponse(payload), FakeResponse(payload)]
        with patch.object(drand, "urlopen", side_effect=responses), \
             patch.object(drand.asyncio, "sleep", new_callable=AsyncMock) as sleep:
            result = asyncio.run(drand.fetch(7))

        self.assertEqual(result, payload)
        sleep.assert_awaited_once_with(1)

    def test_fetch_rejects_non_positive_round(self):
        with self.assertRaisesRegex(ValueError, "must be positive"):
            asyncio.run(drand.fetch(0))
