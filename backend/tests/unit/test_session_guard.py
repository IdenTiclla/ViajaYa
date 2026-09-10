"""The socket watcher must finish validation cleanup before its owner exits."""

import asyncio

from app.api.v1.ws.session_guard import guard_session


async def test_disconnect_waits_for_active_validation_to_release_its_resources():
    started = asyncio.Event()
    release = asyncio.Event()
    disconnected = asyncio.Event()
    cleaned = asyncio.Event()

    async def validate():
        started.set()
        try:
            await release.wait()
        finally:
            cleaned.set()

    class Socket:
        async def close(self, code):
            disconnected.set()

    task = asyncio.create_task(guard_session(
        Socket(), disconnected.wait(), validate, interval_seconds=0.05,
    ))
    await asyncio.wait_for(started.wait(), timeout=1)
    disconnected.set()
    await asyncio.sleep(0)
    assert not task.done()
    release.set()
    await asyncio.wait_for(task, timeout=1)
    assert cleaned.is_set()
