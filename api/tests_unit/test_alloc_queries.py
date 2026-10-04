import asyncio
import time
from unittest.mock import AsyncMock

from app.alloc import _Connection, _all, _one


def test_queries_await_execute_and_fetch():
    cursor = AsyncMock()
    cursor.fetchone.return_value = (7,)
    cursor.fetchall.return_value = [(7,), (8,)]
    connection = AsyncMock()
    connection.execute.return_value = cursor
    assert asyncio.run(_one(connection, "SELECT %s", (7,))) == (7,)
    assert asyncio.run(_all(connection, "SELECT %s", (8,))) == [(7,), (8,)]
    assert connection.execute.await_count == 2
    cursor.fetchone.assert_awaited_once()
    cursor.fetchall.assert_awaited_once()


def test_adapter_does_not_block_the_event_loop_during_a_query():
    class SlowCursor:
        def execute(self, sql, params):
            time.sleep(0.3)

    class SlowConnection:
        def cursor(self, **_kwargs):
            return SlowCursor()

    async def run():
        ticks = 0

        async def ticker():
            nonlocal ticks
            while True:
                await asyncio.sleep(0.02)
                ticks += 1

        task = asyncio.create_task(ticker())
        await _Connection(SlowConnection()).execute("SELECT 1")
        task.cancel()
        return ticks

    assert asyncio.run(run()) >= 5

