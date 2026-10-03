"""Proof round trip: nonces solved by the JS worker code verify in Python, and the reverse."""
import json
import shutil
import subprocess
import uuid
from pathlib import Path

import pytest

from fairdrop_common import pow as fpow

FRONTEND = Path(__file__).resolve().parents[2] / "frontend"
NODE = shutil.which("node")
pytestmark = pytest.mark.skipif(
    not NODE or not (FRONTEND / "node_modules" / "hash-wasm").exists(),
    reason="needs node and `npm install` in frontend/")


def _node(*args) -> dict:
    r = subprocess.run([NODE, "src/pow/cli.mjs", *map(str, args)], cwd=FRONTEND,
                       capture_output=True, text=True, timeout=120)
    assert r.returncode == 0, r.stderr
    return json.loads(r.stdout)


CH = fpow.challenge(b"k" * 32, uuid.UUID(int=7), "id_roundtrip", "2026-10-04T13:00:05Z")


@pytest.mark.parametrize("bits,k,mem", [(3, 4, 64), (5, 3, 256)])
def test_js_solves_python_verifies(bits, k, mem):
    nonces = _node("solve", CH.hex(), bits, k, mem)["nonces"]
    assert fpow.verify(CH, nonces, bits, k, mem)
    assert nonces == fpow.solve(CH, bits, k, mem)        # both find the smallest nonce


@pytest.mark.parametrize("bits,k,mem", [(3, 4, 64), (5, 3, 256)])
def test_python_solves_js_verifies(bits, k, mem):
    nonces = fpow.solve(CH, bits, k, mem)
    assert _node("verify", CH.hex(), bits, k, mem, json.dumps(nonces))["ok"] is True
    bad = [n + 1 for n in nonces]
    assert _node("verify", CH.hex(), bits, k, mem, json.dumps(bad))["ok"] is fpow.verify(CH, bad, bits, k, mem)
