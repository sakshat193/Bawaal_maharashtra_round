import asyncio
from types import SimpleNamespace

from fastapi import FastAPI

from app import alloc


def test_each_app_owns_its_allocation_task(monkeypatch):
    started, stopped = [], []

    async def background():
        task = asyncio.current_task()
        started.append(task)
        try:
            await asyncio.Future()
        finally:
            stopped.append(task)

    monkeypatch.setattr(alloc, "background", background)
    monkeypatch.setattr(alloc, "get_settings", lambda: SimpleNamespace(scheduler_enabled=True), raising=False)

    async def run():
        app = FastAPI()
        async with alloc.router.lifespan_context(app):
            await asyncio.sleep(0)
            async with alloc.router.lifespan_context(app):
                await asyncio.sleep(0)
                assert len(started) == 2
            assert stopped == [started[1]]
        assert stopped == [started[1], started[0]]

    asyncio.run(run())
