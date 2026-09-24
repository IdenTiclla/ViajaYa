"""Per-connection Redis leases for the passenger's shared presence."""

from __future__ import annotations

import asyncio
import re
import uuid
from collections.abc import Sequence
from typing import Protocol

from redis.asyncio import Redis

from app.application.dto import PassengerPresenceObservation
from app.application.exceptions import PassengerPresenceUnavailableError
from app.application.interfaces import PassengerPresenceLeaseStore
from app.infrastructure.realtime.hub import RealtimeHub, hub

_KEY_PREFIX_PATTERN = re.compile(r"^[A-Za-z0-9:._-]+$")
_KEY_TTL_PADDING_MS = 1_000

_TOUCH_SCRIPT = """
local clock = redis.call('TIME')
local now = (tonumber(clock[1]) * 1000) + math.floor(tonumber(clock[2]) / 1000)
local active_ms = tonumber(ARGV[2])
local grace_ms = tonumber(ARGV[3])
redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', now - grace_ms)
redis.call('ZADD', KEYS[1], now + active_ms, ARGV[1])
local latest = redis.call('ZREVRANGE', KEYS[1], 0, 0, 'WITHSCORES')
local deadline = tonumber(latest[2]) + grace_ms
redis.call('PEXPIRE', KEYS[1], math.max(1, deadline - now + tonumber(ARGV[4])))
return math.max(1, deadline - now)
"""

_OBSERVE_SCRIPT = """
local clock = redis.call('TIME')
local now = (tonumber(clock[1]) * 1000) + math.floor(tonumber(clock[2]) / 1000)
local grace_ms = tonumber(ARGV[1])
redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', now - grace_ms)
local latest = redis.call('ZREVRANGE', KEYS[1], 0, 0, 'WITHSCORES')
if #latest == 0 then
  return {0, 0, 0}
end
local latest_score = tonumber(latest[2])
local live = redis.call('ZCOUNT', KEYS[1], '(' .. now, '+inf')
local remaining = math.max(0, latest_score + grace_ms - now)
return {live > 0 and 1 or 0, remaining > 0 and 1 or 0, remaining}
"""

_PRESENT_MANY_SCRIPT = """
local clock = redis.call('TIME')
local now = (tonumber(clock[1]) * 1000) + math.floor(tonumber(clock[2]) / 1000)
local grace_ms = tonumber(ARGV[1])
local result = {}
for index, key in ipairs(KEYS) do
  redis.call('ZREMRANGEBYSCORE', key, '-inf', now - grace_ms)
  local latest = redis.call('ZREVRANGE', key, 0, 0, 'WITHSCORES')
  if #latest > 0 and tonumber(latest[2]) + grace_ms > now then
    result[index] = 1
  else
    result[index] = 0
  end
end
return result
"""


class _RedisPresenceClient(Protocol):
    async def ping(self) -> bool: ...

    async def eval(
        self,
        script: str,
        numkeys: int,
        *keys_and_args: object,
    ) -> object: ...

    async def aclose(self) -> None: ...


class RedisPassengerPresenceStore(PassengerPresenceLeaseStore):
    """Mantiene un sorted set acotado por ride usando exclusivamente Redis TIME."""

    def __init__(
        self,
        client: _RedisPresenceClient,
        *,
        key_prefix: str,
        lease_seconds: float,
        grace_seconds: float,
        timeout_seconds: float,
        transport_hub: RealtimeHub = hub,
    ) -> None:
        if not key_prefix or not _KEY_PREFIX_PATTERN.fullmatch(key_prefix):
            raise ValueError("The Redis presence prefix is not valid.")
        if lease_seconds <= 0 or grace_seconds <= 0 or timeout_seconds <= 0:
            raise ValueError("Presence timings must be positive.")
        self._client = client
        self._key_prefix = key_prefix.rstrip(":")
        self._lease_ms = round(lease_seconds * 1000)
        self._grace_ms = round(grace_seconds * 1000)
        self._grace_seconds = grace_seconds
        self._timeout_seconds = timeout_seconds
        self._hub = transport_hub
        self._healthy = False
        self._closed = False
        self._renewal_count = 0
        self._disconnect_count = 0
        self._observation_count = 0
        self._failure_count = 0

    @classmethod
    def from_url(
        cls,
        url: str,
        *,
        key_prefix: str,
        lease_seconds: float,
        grace_seconds: float,
        timeout_seconds: float,
        transport_hub: RealtimeHub = hub,
    ) -> RedisPassengerPresenceStore:
        client = Redis.from_url(
            url,
            decode_responses=True,
            socket_connect_timeout=timeout_seconds,
            socket_timeout=timeout_seconds,
            health_check_interval=30,
        )
        return cls(
            client,
            key_prefix=key_prefix,
            lease_seconds=lease_seconds,
            grace_seconds=grace_seconds,
            timeout_seconds=timeout_seconds,
            transport_hub=transport_hub,
        )

    @property
    def healthy(self) -> bool:
        return self._healthy and not self._closed

    @property
    def renewal_count(self) -> int:
        return self._renewal_count

    @property
    def disconnect_count(self) -> int:
        return self._disconnect_count

    @property
    def observation_count(self) -> int:
        return self._observation_count

    @property
    def failure_count(self) -> int:
        return self._failure_count

    async def preflight(self) -> None:
        await self.check()

    async def check(self) -> None:
        try:
            async with asyncio.timeout(self._timeout_seconds):
                if not await self._client.ping():
                    raise RuntimeError("Redis did not answer PONG.")
        except Exception as error:
            self._mark_failure()
            raise PassengerPresenceUnavailableError(
                "Redis did not confirm the shared presence."
            ) from error
        self._healthy = True

    async def renew_websocket(
        self,
        ride_id: uuid.UUID,
        connection_id: uuid.UUID,
    ) -> float:
        remaining = await self._touch(
            ride_id,
            f"ws:{connection_id}",
            self._lease_ms,
        )
        self._renewal_count += 1
        return remaining

    async def disconnect_websocket(
        self,
        ride_id: uuid.UUID,
        connection_id: uuid.UUID,
    ) -> float:
        # The score moves to ``now``: the member keeps exactly the grace period,
        # without deleting the leases of other connections or processes.
        remaining = await self._touch(ride_id, f"ws:{connection_id}", 0)
        self._disconnect_count += 1
        return remaining

    async def renew_http(self, ride_id: uuid.UUID) -> float:
        # The HTTP response is a pulse, not a persistent connection.
        remaining = await self._touch(ride_id, "http", 0)
        self._renewal_count += 1
        return remaining

    async def observe(self, ride_id: uuid.UUID) -> PassengerPresenceObservation:
        self._require_transport_health()
        recovery_remaining = self._hub.shared_transport_recovery_grace_remaining(
            self._grace_seconds
        )
        if recovery_remaining > 0:
            return PassengerPresenceObservation(
                live=False,
                present=True,
                retry_after_seconds=recovery_remaining,
            )
        raw = await self._eval(
            _OBSERVE_SCRIPT,
            [self._key(ride_id)],
            [self._grace_ms],
        )
        if not isinstance(raw, (list, tuple)) or len(raw) != 3:
            self._mark_failure()
            raise PassengerPresenceUnavailableError(
                "Redis returned an invalid presence cut."
            )
        self._observation_count += 1
        return PassengerPresenceObservation(
            live=bool(int(raw[0])),
            present=bool(int(raw[1])),
            retry_after_seconds=max(0.0, int(raw[2]) / 1000),
        )

    async def present_ride_ids(
        self,
        ride_ids: Sequence[uuid.UUID],
    ) -> set[uuid.UUID]:
        if not ride_ids:
            return set()
        self._require_transport_health()
        recovery_remaining = self._hub.shared_transport_recovery_grace_remaining(
            self._grace_seconds
        )
        if recovery_remaining > 0:
            return set(ride_ids)
        raw = await self._eval(
            _PRESENT_MANY_SCRIPT,
            [self._key(ride_id) for ride_id in ride_ids],
            [self._grace_ms],
        )
        if not isinstance(raw, (list, tuple)) or len(raw) != len(ride_ids):
            self._mark_failure()
            raise PassengerPresenceUnavailableError(
                "Redis returned an invalid presence filter."
            )
        self._observation_count += len(ride_ids)
        return {
            ride_id
            for ride_id, present in zip(ride_ids, raw, strict=True)
            if bool(int(present))
        }

    async def aclose(self) -> None:
        if self._closed:
            return
        self._closed = True
        self._healthy = False
        await self._client.aclose()

    async def _touch(
        self,
        ride_id: uuid.UUID,
        member: str,
        active_ms: int,
    ) -> float:
        raw = await self._eval(
            _TOUCH_SCRIPT,
            [self._key(ride_id)],
            [member, active_ms, self._grace_ms, _KEY_TTL_PADDING_MS],
        )
        try:
            return max(0.001, int(raw) / 1000)
        except (TypeError, ValueError) as error:
            self._mark_failure()
            raise PassengerPresenceUnavailableError(
                "Redis returned an invalid presence deadline."
            ) from error

    async def _eval(
        self,
        script: str,
        keys: Sequence[str],
        arguments: Sequence[object],
    ) -> object:
        if self._closed:
            raise PassengerPresenceUnavailableError(
                "The presence store was already closed."
            )
        try:
            async with asyncio.timeout(self._timeout_seconds):
                result = await self._client.eval(
                    script,
                    len(keys),
                    *keys,
                    *arguments,
                )
        except Exception as error:
            self._mark_failure()
            raise PassengerPresenceUnavailableError(
                "Redis could not coordinate the shared presence."
            ) from error
        self._healthy = True
        return result

    def _require_transport_health(self) -> None:
        if not self._hub.shared_transport_healthy:
            raise PassengerPresenceUnavailableError(
                "The shared transport is not healthy."
            )

    def _mark_failure(self) -> None:
        self._healthy = False
        self._failure_count += 1

    def _key(self, ride_id: uuid.UUID) -> str:
        return f"{self._key_prefix}:ride:{ride_id}"
