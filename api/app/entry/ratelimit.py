"""In-process token bucket per client address. The edge does the real job; this is for the demo."""
import ipaddress
import threading
import time

from fastapi import Request

from ..config import get_settings
from ..errors import ApiError


def _trusted(host: str) -> bool:
    """A configured proxy: exact entry (e.g. "testclient") or an address inside a listed CIDR."""
    items = get_settings().trusted_proxies
    if host in items:
        return True
    try:
        addr = ipaddress.ip_address(host)
    except ValueError:
        return False
    for item in items:
        try:
            if addr in ipaddress.ip_network(item, strict=False):
                return True
        except ValueError:
            continue
    return False


def client_ip(request: Request) -> str:
    """Peer address, or the right-most untrusted X-Forwarded-For hop when the peer is a trusted proxy."""
    peer = request.client.host if request.client else "unknown"
    if not _trusted(peer):
        return peer
    hops = [h.strip() for h in request.headers.get("x-forwarded-for", "").split(",") if h.strip()]
    for hop in reversed(hops):
        if not _trusted(hop):
            try:
                ipaddress.ip_address(hop)
                return hop
            except ValueError:
                break
    return peer


def via_trusted_proxy(request: Request) -> bool:
    return bool(request.client) and _trusted(request.client.host)


def subnet_of(ip: str) -> str | None:
    """IPv4 /24 or IPv6 /48 around ip, None for a non-address. The full IP is never stored."""
    try:
        addr = ipaddress.ip_address(ip)
    except ValueError:
        return None
    addr = getattr(addr, "ipv4_mapped", None) or addr
    return str(ipaddress.ip_network(f"{addr}/{24 if addr.version == 4 else 48}", strict=False))


class TokenBucket:
    def __init__(self, rate: float, burst: int):
        self.rate, self.burst = rate, burst
        self._state: dict[str, tuple[float, float]] = {}
        self._lock = threading.Lock()

    def allow(self, key: str) -> bool:
        now = time.monotonic()
        with self._lock:
            tokens, last = self._state.get(key, (float(self.burst), now))
            tokens = min(self.burst, tokens + (now - last) * self.rate)
            if tokens < 1:
                self._state[key] = (tokens, now)
                return False
            self._state[key] = (tokens - 1, now)
            if len(self._state) > 100_000:  # crude bound on memory
                self._state.clear()
            return True


_buckets: dict[str, TokenBucket] = {}


def limit(bucket: str):
    """FastAPI dependency: 429 when this client address exceeds the bucket."""
    def dep(request: Request) -> None:
        s = get_settings()
        if not s.rate_limit_enabled:
            return
        b = _buckets.setdefault(bucket, TokenBucket(s.rate_limit_rps, s.rate_limit_burst))
        if not b.allow(client_ip(request)):
            raise ApiError(429, "rate_limited", "too many requests; slow down")
    return dep
