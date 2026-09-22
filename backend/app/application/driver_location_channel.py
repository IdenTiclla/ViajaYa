"""Ephemeral latest-value storage and private fanout port."""

from abc import ABC, abstractmethod
from collections.abc import AsyncIterator
from contextlib import AbstractAsyncContextManager
from uuid import UUID

from app.domain.driver_location import DriverLocation


class DriverLocationChannel(ABC):
    @abstractmethod
    async def latest(self, ride_id: UUID) -> DriverLocation | None: ...

    @abstractmethod
    async def publish(self, location: DriverLocation) -> bool:
        """Store and fan out only a newer sample; return whether it was accepted."""
        ...

    @abstractmethod
    def subscribe(
        self, ride_id: UUID
    ) -> AbstractAsyncContextManager[AsyncIterator[DriverLocation]]: ...

    @abstractmethod
    async def aclose(self) -> None:
        pass
