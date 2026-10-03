"""Third-party timestamps for the snapshot hash.

What each backend proves, honestly:
  ots  An OpenTimestamps calendar attestation. Until the calendar anchors it in a
       Bitcoin block (hours later; run `ots upgrade` on the stored file) it is only
       as trustworthy as the calendar operator. Several calendars are used.
  git  A commit pushed to a public repository. Evidence as strong as your trust in
       the host's commit/push timestamps.
Together they are much better than our own server clock, which proves nothing.
"""
import base64
import subprocess
from pathlib import Path
from typing import Protocol

import httpx

from ..config import get_settings
from ..timefmt import iso_s, utcnow

# DetachedTimestampFile header: magic, major version 1, then the file-hash op (0x08 = SHA256).
OTS_MAGIC = b"\x00OpenTimestamps\x00\x00Proof\x00\xbf\x89\xe2\xe8\x84\xe8\x92\x94"
OTS_VERSION = b"\x01"
OTS_OP_SHA256 = b"\x08"


class TimestampError(RuntimeError):
    pass


class Timestamper(Protocol):
    name: str

    def stamp(self, drop_id: str, snapshot_sha256: str) -> dict: ...


class OtsCalendars:
    """POST the digest to each calendar; the response is the serialized timestamp for that
    digest. We wrap each in a complete .ots file that `ots info` / `ots upgrade` accept."""
    name = "ots"

    def __init__(self, calendars: list[str], min_ok: int = 1, timeout: float = 10.0):
        self.calendars, self.min_ok, self.timeout = calendars, min_ok, timeout

    def stamp(self, drop_id: str, snapshot_sha256: str) -> dict:
        digest = bytes.fromhex(snapshot_sha256)
        out, errors = [], []
        with httpx.Client(timeout=self.timeout) as c:
            for cal in self.calendars:
                try:
                    r = c.post(cal.rstrip("/") + "/digest", content=digest,
                               headers={"Accept": "application/vnd.opentimestamps.v1",
                                        "User-Agent": "fairdrop-seal/1"})
                    r.raise_for_status()
                    ots_file = OTS_MAGIC + OTS_VERSION + OTS_OP_SHA256 + digest + r.content
                    out.append({"calendar": cal, "received_at": iso_s(utcnow()),
                                "ots_file_b64": base64.b64encode(ots_file).decode("ascii")})
                except httpx.HTTPError as e:
                    errors.append(f"{cal}: {e}")
        if len(out) < self.min_ok:
            raise TimestampError("no OpenTimestamps calendar accepted the digest: " + "; ".join(errors))
        return {"calendars": out, "note": "pending calendar attestation until anchored in Bitcoin"}


class GitCommit:
    """Commit the hash into a local clone of a public repository and push it."""
    name = "git"

    def __init__(self, repo_dir: str, web_url: str = ""):
        self.repo, self.web_url = Path(repo_dir), web_url.rstrip("/")

    def _git(self, *args: str) -> str:
        r = subprocess.run(["git", "-C", str(self.repo), *args], capture_output=True, text=True, timeout=60)
        if r.returncode != 0:
            raise TimestampError(f"git {' '.join(args)} failed: {r.stderr.strip()}")
        return r.stdout.strip()

    def stamp(self, drop_id: str, snapshot_sha256: str) -> dict:
        if not self.repo.is_dir():
            raise TimestampError(f"TIMESTAMP_GIT_DIR {self.repo} is not a directory")
        rel = Path("snapshots") / f"{drop_id}.txt"
        (self.repo / rel).parent.mkdir(parents=True, exist_ok=True)
        (self.repo / rel).write_text(f"drop_id {drop_id}\nsnapshot_sha256 {snapshot_sha256}\n", encoding="ascii")
        self._git("add", rel.as_posix())
        self._git("commit", "-m", f"fairdrop snapshot {drop_id} {snapshot_sha256}")
        self._git("push")
        sha = self._git("rev-parse", "HEAD")
        return {"commit": sha, "path": rel.as_posix(),
                "commit_url": f"{self.web_url}/commit/{sha}" if self.web_url else None}


class DevClockOnly:
    """DEV ONLY: records our own clock and proves nothing. Used by seed_entries.py and tests
    so the draw can be built offline. Never configure it for a real drop."""
    name = "dev_clock_only"

    def stamp(self, drop_id: str, snapshot_sha256: str) -> dict:
        return {"warning": "DEV ONLY: server clock, not third-party evidence", "at": iso_s(utcnow())}


class Composite:
    """Every configured backend must succeed, otherwise the stamp fails (and can be retried)."""

    def __init__(self, backends: list[Timestamper]):
        if not backends:
            raise ValueError("no timestamp backends configured")
        self.backends = backends

    def stamp(self, drop_id: str, snapshot_sha256: str) -> dict:
        proof = {"snapshot_sha256": snapshot_sha256}
        for b in self.backends:
            proof[b.name] = b.stamp(drop_id, snapshot_sha256)
        return proof


def from_settings() -> Composite:
    s = get_settings()
    backends: list[Timestamper] = []
    for name in s.timestamp_backends:
        if name == "ots":
            backends.append(OtsCalendars(s.ots_calendars))
        elif name == "git":
            backends.append(GitCommit(s.timestamp_git_dir, s.timestamp_git_web_url))
        else:
            raise ValueError(f"unknown timestamp backend {name!r} (use ots, git)")
    return Composite(backends)
