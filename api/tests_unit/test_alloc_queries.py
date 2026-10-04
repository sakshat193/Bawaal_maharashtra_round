import asyncio
from unittest.mock import AsyncMock

from app.alloc import _all, _one


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
