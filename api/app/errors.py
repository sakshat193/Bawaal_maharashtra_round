"""Every error leaves the API as {"error": "<code>", "message": "<text>", ...extra}."""
from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException


class ApiError(Exception):
    def __init__(self, status: int, code: str, message: str = "", **extra):
        super().__init__(f"{status} {code}: {message}")
        self.status, self.code, self.message, self.extra = status, str(code), message, extra


def install_error_handlers(app: FastAPI) -> None:
    @app.exception_handler(ApiError)
    async def _api_error(_: Request, exc: ApiError):
        return JSONResponse({"error": exc.code, "message": exc.message, **exc.extra}, status_code=exc.status)

    @app.exception_handler(RequestValidationError)
    async def _validation(_: Request, exc: RequestValidationError):
        first = exc.errors()[0] if exc.errors() else {}
        where = ".".join(str(p) for p in first.get("loc", ()))
        return JSONResponse({"error": "invalid_request", "message": f"{where}: {first.get('msg', 'invalid')}"},
                            status_code=422)

    @app.exception_handler(StarletteHTTPException)
    async def _http(_: Request, exc: StarletteHTTPException):
        code = {404: "not_found", 401: "unauthorized", 405: "invalid_request"}.get(exc.status_code, "error")
        return JSONResponse({"error": code, "message": str(exc.detail)}, status_code=exc.status_code)
