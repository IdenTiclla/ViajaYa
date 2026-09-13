"""A live connection and subsequent handshakes lose access after session revocation."""

import uuid

import pytest
from starlette.websockets import WebSocketDisconnect

from app.api.deps import build_managed_sessions
from app.infrastructure.db.models import UserModel
from tests.e2e.helpers import sign_in_sync, test_settings
from tests.e2e.test_negotiation_ws import (
    _headers,
    _ride_payload,
    _websocket_connect,
)
from tests.e2e.test_negotiation_ws import (
    ws_client as ws_client,
)


def test_managed_session_revocation_closes_live_socket_and_rejects_reconnect(ws_client):
    account = sign_in_sync(ws_client, "managed-ws")

    async def create_session():
        async with ws_client.factory() as session:
            user = await session.get(UserModel, uuid.UUID(account.user_id))
            access = build_managed_sessions(session, test_settings())
            await access.accounts.lock_user(user.id)
            grant = await access.create(user.id, uuid.uuid4(), "WebSocket test")
            await session.commit()
            return access.tokens.create_session_pair(grant)

    tokens = ws_client.portal.call(create_session)
    ride = ws_client.post("/api/v1/rides", json=_ride_payload(),
                          headers=_headers(tokens.access_token)).json()
    url = f"/api/v1/ws/rides/{ride['id']}?token={tokens.access_token}"
    with _websocket_connect(ws_client, url) as socket:
        assert socket.receive_json()["type"] == "offers_snapshot"
        assert ws_client.post("/api/v1/auth/logout", json={
            "refresh_token": tokens.refresh_token,
        }).status_code == 204
        with pytest.raises(WebSocketDisconnect) as closed:
            socket.receive_json()
        assert closed.value.code == 1008
    with _websocket_connect(ws_client, url) as socket:
        with pytest.raises(WebSocketDisconnect) as rejected:
            socket.receive_json()
        assert rejected.value.code == 1008
