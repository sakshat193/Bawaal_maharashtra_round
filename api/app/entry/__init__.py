"""Member 2: platform, drops, challenge, entries, seal."""
from fastapi import APIRouter

from . import admin, drops, entries, evidence, platform
from .platform import Identity, current_identity  # re-exported for Member 3

router = APIRouter()
for _r in (platform.router, drops.router, entries.router, evidence.router, admin.router):
    router.include_router(_r)

__all__ = ["router", "current_identity", "Identity"]
