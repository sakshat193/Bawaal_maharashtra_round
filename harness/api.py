"""Small asynchronous client for the public harness API calls."""

from __future__ import annotations

import httpx


class FairDropApi:
    def __init__(self, base_url: str, admin_key: str):
        self.base_url = base_url.rstrip("/")
        self.admin_key = admin_key
        self.http = httpx.AsyncClient(timeout=30.0, follow_redirects=True)

    async def close(self):
        await self.http.aclose()

    async def request(self, method: str, path: str, *, body=None, token=None, admin=False):
        headers = {}
        if token:
            headers["Authorization"] = f"Bearer {token}"
        if admin:
            headers["X-Admin-Key"] = self.admin_key
        response = await self.http.request(
            method, f"{self.base_url}/{path.lstrip('/')}", headers=headers, json=body
        )
        return response

    @staticmethod
    def payload(response: httpx.Response) -> dict:
        try:
            value = response.json()
        except ValueError:
            value = {"message": response.text}
        return value if isinstance(value, dict) else {"data": value}

    async def checked(self, method: str, path: str, **kwargs) -> dict:
        response = await self.request(method, path, **kwargs)
        if response.is_error:
            data = self.payload(response)
            code = data.get("error", data.get("detail", data.get("message", "request failed")))
            raise RuntimeError(f"{method} {path} returned {response.status_code}: {code}")
        return self.payload(response)


def bearer_token(payload: dict) -> str:
    identity = payload.get("identity") if isinstance(payload.get("identity"), dict) else {}
    token = payload.get("access_token") or payload.get("token") or payload.get("jwt") or identity.get("token")
    if not isinstance(token, str) or not token:
        raise RuntimeError("login response did not include a JWT")
    return token

