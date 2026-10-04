"""STUB for Member 3's drand.py (round_at / time_of only). Delete when the real one lands."""
import math
from datetime import datetime

CHAIN = "52db9ba70e0cc0f6eaf7803dd07447a1f5477735fd3f661792ba94600c84e971"
GENESIS = 1692803367
PERIOD = 3


def _ts(ts) -> float:
    return ts.timestamp() if isinstance(ts, datetime) else float(ts)


def round_at(ts) -> int:
    """First round due at or after ts (unix seconds or aware datetime)."""
    t = _ts(ts)
    if t <= GENESIS:
        return 1
    return math.ceil((t - GENESIS) / PERIOD) + 1


def time_of(r: int) -> int:
    """Unix seconds at which round r is due."""
    return GENESIS + (r - 1) * PERIOD
