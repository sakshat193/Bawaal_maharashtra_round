"""Settings from the environment. Keys are loaded from files, never generated here."""
import os
from dataclasses import dataclass, field
from functools import lru_cache
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]

# Cloudflare's documented always-pass Turnstile test secret. With it, siteverify
# returns success but a dummy hostname/action, so those two checks are skipped.
TURNSTILE_TEST_SECRET = "1x0000000000000000000000000000000AA"


def _bool(name: str, default: bool) -> bool:
    v = os.environ.get(name)
    return default if v is None else v.strip().lower() in ("1", "true", "yes", "on")


def _list(name: str, default: str = "") -> list[str]:
    return [s.strip() for s in os.environ.get(name, default).split(",") if s.strip()]


@dataclass(frozen=True)
class Settings:
    database_url: str = field(default_factory=lambda: os.environ.get(
        "DATABASE_URL", "postgresql://fairdrop:fairdrop@localhost:5433/fairdrop"))
    admin_key: str = field(default_factory=lambda: os.environ.get("ADMIN_KEY", ""))

    platform_key_file: Path = field(default_factory=lambda: Path(os.environ.get(
        "PLATFORM_KEY_FILE", REPO_ROOT / "keys" / "platform_ed25519.pem")))
    receipt_key_file: Path = field(default_factory=lambda: Path(os.environ.get(
        "RECEIPT_KEY_FILE", REPO_ROOT / "keys" / "receipt_ed25519.pem")))
    pow_key_file: Path = field(default_factory=lambda: Path(os.environ.get(
        "POW_KEY_FILE", REPO_ROOT / "keys" / "pow_hmac.key")))

    # DEMO_MODE lets /platform/login take risk facts from the request body so the
    # harness can plant Sybil clusters. A real identity platform would NEVER take
    # these from the client; with DEMO_MODE off the body fields are ignored.
    demo_mode: bool = field(default_factory=lambda: _bool("DEMO_MODE", False))

    jwt_ttl_s: int = field(default_factory=lambda: int(os.environ.get("JWT_TTL_S", "900")))

    turnstile_secret: str = field(default_factory=lambda: os.environ.get(
        "TURNSTILE_SECRET", TURNSTILE_TEST_SECRET))
    turnstile_hostnames: list[str] = field(default_factory=lambda: _list("TURNSTILE_HOSTNAMES"))
    trusted_proxies: list[str] = field(default_factory=lambda: _list("TRUSTED_PROXIES"))

    # Margin between closes_at and round R: must cover the seal and the timestamp.
    drand_margin_s: int = field(default_factory=lambda: max(120, int(os.environ.get("DRAND_MARGIN_S", "120"))))

    scheduler_enabled: bool = field(default_factory=lambda: _bool("SCHEDULER_ENABLED", True))

    rate_limit_enabled: bool = field(default_factory=lambda: _bool("RATE_LIMIT_ENABLED", True))
    rate_limit_rps: float = field(default_factory=lambda: float(os.environ.get("RATE_LIMIT_RPS", "2")))
    rate_limit_burst: int = field(default_factory=lambda: int(os.environ.get("RATE_LIMIT_BURST", "20")))

    # Comma list from {ots, git}. Every listed backend must succeed for a seal to be stamped.
    timestamp_backends: list[str] = field(default_factory=lambda: _list("TIMESTAMP_BACKENDS", "ots"))
    ots_calendars: list[str] = field(default_factory=lambda: _list(
        "OTS_CALENDARS",
        "https://a.pool.opentimestamps.org,https://b.pool.opentimestamps.org,"
        "https://a.pool.eternitywall.com"))
    timestamp_git_dir: str = field(default_factory=lambda: os.environ.get("TIMESTAMP_GIT_DIR", ""))
    timestamp_git_web_url: str = field(default_factory=lambda: os.environ.get("TIMESTAMP_GIT_WEB_URL", ""))

    pow_workers: int = field(default_factory=lambda: int(os.environ.get("POW_WORKERS", str(os.cpu_count() or 2))))

    cors_origins: list[str] = field(default_factory=lambda: _list(
        "CORS_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173"))

    def check(self) -> None:
        if not self.admin_key or len(self.admin_key) < 16:
            raise RuntimeError("ADMIN_KEY must be set (at least 16 characters)")
        for p in (self.platform_key_file, self.receipt_key_file, self.pow_key_file):
            if not p.exists():
                raise RuntimeError(f"missing key file {p}; run scripts/gen_keys.py once (keys are never regenerated)")


@lru_cache
def get_settings() -> Settings:
    return Settings()
