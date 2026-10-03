"""Router wiring, one line per member."""
import asyncio
import importlib
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .config import get_settings
from .db import close_pool, get_pool
from .errors import install_error_handlers

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")


def _optional(module: str):
    """Import another member's package if it exists yet; real errors inside it still raise."""
    try:
        return importlib.import_module(module, __package__)
    except ModuleNotFoundError as e:
        if e.name and e.name.endswith(module.lstrip(".")):
            return None
        raise


@asynccontextmanager
async def lifespan(app: FastAPI):
    s = get_settings()
    s.check()
    get_pool()
    stop = asyncio.Event()
    task = None
    if s.scheduler_enabled:
        from .entry import scheduler
        task = asyncio.create_task(scheduler.run_forever(stop))
    yield
    stop.set()
    if task:
        await task
    close_pool()


def create_app() -> FastAPI:
    app = FastAPI(title="Fair Drop", version="0.1.0", lifespan=lifespan)
    install_error_handlers(app)
    app.add_middleware(CORSMiddleware, allow_origins=get_settings().cors_origins, allow_methods=["*"],
                       allow_headers=["*"], expose_headers=["*"])

    from .entry import router as entry_router
    app.include_router(entry_router)                       # Member 2: entry + identity
    alloc = _optional(".alloc")
    if alloc is not None:
        app.include_router(alloc.router)                   # Member 3: allocation
    return app


app = create_app()
