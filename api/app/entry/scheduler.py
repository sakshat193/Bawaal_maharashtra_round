"""Flips scheduled -> open at opens_at and seals at closes_at, using server time only.

Safe with several API processes: opening is a single conditional UPDATE and the seal
holds a per-drop advisory lock. Also retries a seal whose timestamp failed, as long as
round R is not yet due.
"""
import asyncio
import logging

from ..db import get_pool
from . import seal as sealmod

log = logging.getLogger("fairdrop.scheduler")
TICK_S = 1.0


def _due_work() -> list:
    with get_pool().connection() as conn:
        opened = conn.execute(
            "UPDATE drops SET phase='open' WHERE phase='scheduled' AND opens_at <= now() "
            "AND closes_at > now() RETURNING drop_id").fetchall()
        for r in opened:
            log.info("opened %s", r["drop_id"])
        rows = conn.execute(
            """SELECT d.drop_id FROM drops d LEFT JOIN snapshots s USING (drop_id)
                WHERE (d.phase IN ('scheduled','open') AND d.closes_at <= now())
                   OR (d.phase = 'sealed' AND (s.drop_id IS NULL OR s.timestamp_proof IS NULL))""").fetchall()
    return [r["drop_id"] for r in rows]


async def run_forever(stop: asyncio.Event) -> None:
    in_flight: set = set()
    retry_after: dict = {}
    loop = asyncio.get_running_loop()
    while not stop.is_set():
        try:
            for drop_id in await asyncio.to_thread(_due_work):
                if drop_id in in_flight or retry_after.get(drop_id, 0) > loop.time():
                    continue
                in_flight.add(drop_id)

                async def _go(d=drop_id):
                    try:
                        await asyncio.to_thread(sealmod.seal, d)
                    except sealmod.SealError as e:
                        log.error("seal %s: %s", d, e)
                        retry_after[d] = loop.time() + 10  # don't hammer calendars on failure
                    except Exception:
                        log.exception("seal %s crashed", d)
                        retry_after[d] = loop.time() + 10
                    finally:
                        in_flight.discard(d)
                asyncio.create_task(_go())
        except Exception:
            log.exception("scheduler tick failed")
        try:
            await asyncio.wait_for(stop.wait(), timeout=TICK_S)
        except asyncio.TimeoutError:
            pass
