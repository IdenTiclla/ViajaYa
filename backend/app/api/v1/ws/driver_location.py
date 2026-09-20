"""Private GPS channel with fresh authorization and latest-value recovery."""

import asyncio
from uuid import UUID

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from app.api.deps import (
    DriverLocationChannelDep,
    SessionFactoryDep,
    SettingsDep,
    build_get_driver_location,
    build_managed_sessions,
)
from app.api.v1.schemas.driver_location import DriverLocationMessage, DriverLocationResponse
from app.api.v1.ws.session_guard import guard_session
from app.domain.exceptions import DomainError
from app.infrastructure.realtime.ws_auth import AUTH_SUBPROTOCOL, token_from_subprotocol

router = APIRouter(tags=["driver-location"])


@router.websocket("/ws/rides/{ride_id}/driver-location")
async def location_ws(
    websocket: WebSocket,
    ride_id: UUID,
    channel: DriverLocationChannelDep,
    session_factory: SessionFactoryDep,
    settings: SettingsDep,
) -> None:
    token = token_from_subprotocol(websocket)
    await websocket.accept(subprotocol=AUTH_SUBPROTOCOL if token else None)
    if not token:
        await websocket.close(code=1008)
        return

    async def current():
        async with session_factory() as session:
            user, _ = await build_managed_sessions(session, settings).authenticate(token)
            return await build_get_driver_location(session, channel).execute(user, ride_id)

    async def send_current():
        location = await current()
        message = DriverLocationMessage(
            data=(DriverLocationResponse.from_location(location) if location else None)
        )
        await websocket.send_json(message.model_dump(mode="json"))

    async def validate():
        await current()

    async def drain():
        try:
            while True:
                await websocket.receive_text()
        except WebSocketDisconnect:
            return

    async def stream(updates):
        async def push():
            async for _ in updates:
                # Recheck terminal state/participants; never forward a cached
                # position just because this socket was authorized earlier.
                await send_current()

        tasks = [asyncio.create_task(push()), asyncio.create_task(drain())]
        try:
            done, _ = await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
            for task in done:
                task.result()
        except DomainError:
            await websocket.close(code=1008)
        except WebSocketDisconnect:
            pass
        except Exception:  # noqa: BLE001 - fail closed without leaking a payload
            await websocket.close(code=1012)
        finally:
            for task in tasks:
                task.cancel()
            await asyncio.gather(*tasks, return_exceptions=True)

    try:
        await current()
        async with channel.subscribe(ride_id) as updates:
            await send_current()
            await guard_session(websocket, stream(updates), validate)
    except DomainError:
        await websocket.close(code=1008)
    except WebSocketDisconnect:
        pass
    except Exception:  # noqa: BLE001 - no GPS or credentials in logs
        try:
            await websocket.close(code=1012)
        except RuntimeError:
            pass
