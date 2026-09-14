"""Revalidate long-lived sockets with fresh database transactions and bounded waits."""

import asyncio
from collections.abc import Awaitable, Callable

import anyio
from fastapi import WebSocket

from app.domain.exceptions import InvalidTokenError


async def guard_session(
    websocket: WebSocket, receive: Awaitable[None], validate: Callable[[], Awaitable[None]],
    *, interval_seconds: float = 5,
) -> None:
    stopped = asyncio.Event()

    async def watch() -> None:
        while not stopped.is_set():
            try:
                await asyncio.wait_for(stopped.wait(), timeout=interval_seconds)
                return
            except TimeoutError:
                pass
            try:
                async with asyncio.timeout(interval_seconds):
                    await validate()
            except InvalidTokenError:
                await websocket.close(code=1008)
                return
            except Exception:  # noqa: BLE001 - fail closed without logging credentials
                await websocket.close(code=1012)
                return

    tasks = [asyncio.ensure_future(receive), asyncio.create_task(watch())]
    try:
        await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
    except asyncio.CancelledError:
        # ASGI shutdown/disconnect may cancel the parent while the watcher owns a DB connection.
        pass
    finally:
        stopped.set()
        tasks[0].cancel()
        # Let the bounded validation finish and close its transaction before returning.
        with anyio.CancelScope(shield=True):
            await asyncio.gather(*tasks, return_exceptions=True)
