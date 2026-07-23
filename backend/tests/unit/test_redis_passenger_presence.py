"""Contrato de leases Redis por conexión para presencia compartida."""

from __future__ import annotations

import uuid

import pytest

from app.application.exceptions import PassengerPresenceUnavailableError
from app.infrastructure.realtime import passenger_presence
from app.infrastructure.realtime.hub import RealtimeHub
from app.infrastructure.realtime.passenger_presence import (
    RedisPassengerPresenceStore,
)


class _FakeRedisPresenceClient:
    def __init__(self) -> None:
        self.now_ms = 1_000_000
        self.sets: dict[str, dict[str, int]] = {}
        self.closed = False
        self.fail = False

    async def ping(self) -> bool:
        if self.fail:
            raise ConnectionError("detalle privado")
        return True

    async def eval(
        self,
        script: str,
        numkeys: int,
        *keys_and_args: object,
    ) -> object:
        if self.fail:
            raise ConnectionError("detalle privado")
        keys = [str(value) for value in keys_and_args[:numkeys]]
        args = keys_and_args[numkeys:]
        if script == passenger_presence._TOUCH_SCRIPT:
            key = keys[0]
            member = str(args[0])
            active_ms = int(args[1])
            grace_ms = int(args[2])
            members = self.sets.setdefault(key, {})
            self._prune(members, grace_ms)
            members[member] = self.now_ms + active_ms
            return max(members.values()) + grace_ms - self.now_ms
        if script == passenger_presence._OBSERVE_SCRIPT:
            members = self.sets.setdefault(keys[0], {})
            grace_ms = int(args[0])
            self._prune(members, grace_ms)
            if not members:
                return [0, 0, 0]
            latest = max(members.values())
            live = any(score > self.now_ms for score in members.values())
            remaining = max(0, latest + grace_ms - self.now_ms)
            return [int(live), int(remaining > 0), remaining]
        if script == passenger_presence._PRESENT_MANY_SCRIPT:
            grace_ms = int(args[0])
            result = []
            for key in keys:
                members = self.sets.setdefault(key, {})
                self._prune(members, grace_ms)
                present = bool(
                    members and max(members.values()) + grace_ms > self.now_ms
                )
                result.append(int(present))
            return result
        raise AssertionError("Script Lua inesperado.")

    async def aclose(self) -> None:
        self.closed = True

    def advance(self, seconds: float) -> None:
        self.now_ms += round(seconds * 1000)

    def _prune(self, members: dict[str, int], grace_ms: int) -> None:
        cutoff = self.now_ms - grace_ms
        for member, score in list(members.items()):
            if score <= cutoff:
                members.pop(member)


def _store(
    client: _FakeRedisPresenceClient,
    local_hub: RealtimeHub | None = None,
) -> RedisPassengerPresenceStore:
    return RedisPassengerPresenceStore(
        client,
        key_prefix="viajaya:test:presence",
        lease_seconds=30,
        grace_seconds=120,
        timeout_seconds=1,
        transport_hub=local_hub or RealtimeHub(),
    )


async def test_desconectar_una_conexion_no_borra_el_lease_de_otra() -> None:
    client = _FakeRedisPresenceClient()
    store = _store(client)
    ride_id = uuid.uuid4()
    first = uuid.uuid4()
    second = uuid.uuid4()

    assert await store.renew_websocket(ride_id, first) == 150
    client.advance(5)
    assert await store.renew_websocket(ride_id, second) == 150
    client.advance(5)
    assert await store.disconnect_websocket(ride_id, first) == 145

    observation = await store.observe(ride_id)
    assert observation.live is True
    assert observation.present is True
    assert observation.retry_after_seconds == 145


async def test_ultima_desconexion_conserva_gracia_y_luego_desaparece() -> None:
    client = _FakeRedisPresenceClient()
    store = _store(client)
    ride_id = uuid.uuid4()
    connection_id = uuid.uuid4()

    await store.renew_websocket(ride_id, connection_id)
    await store.disconnect_websocket(ride_id, connection_id)
    client.advance(119)
    assert (await store.observe(ride_id)).present is True
    client.advance(1)
    observation = await store.observe(ride_id)
    assert observation.live is False
    assert observation.present is False


async def test_heartbeat_http_renueva_solo_la_gracia_del_ride() -> None:
    client = _FakeRedisPresenceClient()
    store = _store(client)
    visible_id = uuid.uuid4()
    absent_id = uuid.uuid4()

    assert await store.renew_http(visible_id) == 120
    assert await store.present_ride_ids([visible_id, absent_id]) == {visible_id}
    client.advance(121)
    assert await store.present_ride_ids([visible_id, absent_id]) == set()


async def test_caida_y_recuperacion_del_transporte_aplazan_toda_cancelacion(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    now = 10.0
    local_hub = RealtimeHub()
    client = _FakeRedisPresenceClient()
    store = _store(client, local_hub)
    monkeypatch.setattr(
        "app.infrastructure.realtime.hub.time.monotonic",
        lambda: now,
    )
    local_hub.set_shared_transport_healthy(False)
    with pytest.raises(PassengerPresenceUnavailableError):
        await store.observe(uuid.uuid4())

    local_hub.set_shared_transport_healthy(True)
    recovered = await store.observe(uuid.uuid4())
    assert recovered.present is True
    assert recovered.live is False
    assert recovered.retry_after_seconds == 120

    now += 121
    assert (await store.observe(uuid.uuid4())).present is False


async def test_fallos_redis_se_sanitizan_y_marcan_el_store_no_sano() -> None:
    client = _FakeRedisPresenceClient()
    store = _store(client)
    await store.preflight()
    assert store.healthy is True
    client.fail = True

    with pytest.raises(PassengerPresenceUnavailableError) as captured:
        await store.renew_http(uuid.uuid4())

    assert "privado" not in str(captured.value)
    assert store.healthy is False
    assert store.failure_count == 1
