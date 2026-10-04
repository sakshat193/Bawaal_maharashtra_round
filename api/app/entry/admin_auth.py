import hmac

from fastapi import Request

from ..config import get_settings
from ..errors import ApiError


def require_admin(request: Request) -> None:
    """Admin routes authenticate with the X-Admin-Key header (constant-time compare)."""
    expected = get_settings().admin_key
    given = request.headers.get("x-admin-key", "")
    if not expected or not hmac.compare_digest(given.encode(), expected.encode()):
        raise ApiError(401, "unauthorized", "admin key required")
