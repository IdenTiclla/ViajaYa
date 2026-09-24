"""Application-layer ports.

Abstractions of technical services (hashing, tokens, OAuth verification) that the
infrastructure implements. Use cases depend only on these interfaces.
"""

from __future__ import annotations

import uuid
from abc import ABC, abstractmethod
from collections.abc import Sequence
from datetime import datetime
from typing import Literal

from app.application.dto import (
    AcceptOfferResult,
    CancelRideResult,
    CreateOfferResult,
    DriverAvailabilityResult,
    DriverEarnings,
    DriverRealtimeSnapshot,
    Page,
    PageCursor,
    PassengerPresenceObservation,
    PassengerRealtimeSnapshot,
    PendingRealtimeEvent,
    PendingScheduledAction,
    PublishedRealtimeOutboxRetentionResult,
    RealtimeOutboxEvent,
    RealtimeOutboxOperationalState,
    RealtimeOutboxQuarantineCode,
    RenewableScheduledAction,
    RideDetail,
    RideHistoryItem,
    RidePausedResult,
    RideRepublishedResult,
    ScheduledAction,
    ScheduledActionsOperationalState,
    SocialProfile,
)
from app.domain.entities import AuthProvider, Offer, RideStatus, UserRole
from app.domain.repositories import OpenRideDetail


class UnitOfWork(ABC):
    """Transactional boundary decided by the application layer."""

    @abstractmethod
    async def commit(self) -> None:
        """Commit the business mutation and its pending events."""

    @abstractmethod
    async def rollback(self) -> None:
        """Discard everything done by the current operation."""


class ScheduledActionScheduler(ABC):
    """Persist deferred actions inside the producing transaction."""

    @abstractmethod
    async def schedule(self, action: PendingScheduledAction) -> ScheduledAction:
        """Insert or renew an action with a strictly greater generation."""

    @abstractmethod
    async def schedule_next(self, action: RenewableScheduledAction) -> ScheduledAction:
        """Insert the first generation or increment the current one under a single CAS."""


class ScheduledActionQueue(ScheduledActionScheduler):
    """Reclama y finaliza acciones mediante leases recuperables."""

    @abstractmethod
    async def claim_due(
        self,
        now: datetime,
        stale_before: datetime,
    ) -> ScheduledAction | None:
        """Claim a due action or recover an abandoned lease."""

    @abstractmethod
    async def lock_owned(
        self,
        action_id: uuid.UUID,
        generation: int,
        lock_token: uuid.UUID,
    ) -> bool:
        """Lock the row only if the caller still holds generation and fencing."""

    @abstractmethod
    async def mark_succeeded(
        self,
        action_id: uuid.UUID,
        generation: int,
        lock_token: uuid.UUID,
        terminal_at: datetime,
    ) -> bool:
        """Confirm success only if the caller still owns the lease."""

    @abstractmethod
    async def mark_succeeded_if_pending(
        self,
        dedupe_key: str,
        generation: int,
        terminal_at: datetime,
    ) -> bool:
        """Complete the legacy timer only if no worker claimed the action."""

    @abstractmethod
    async def mark_failed(
        self,
        action_id: uuid.UUID,
        generation: int,
        lock_token: uuid.UUID,
        *,
        error_code: str,
        next_attempt_at: datetime,
        terminal: bool,
        terminal_at: datetime,
    ) -> bool:
        """Reschedule or exhaust an action, keeping ownership via CAS."""


class ScheduledActionExecutor(ABC):
    """Run the associated use case and confirm the action in the same UoW."""

    @abstractmethod
    async def execute(
        self,
        action: ScheduledAction,
    ) -> Literal["succeeded", "deferred", "lost_lease"]:
        """Process a claimed action without exposing infrastructure details."""


class PassengerPresenceLeaseStore(ABC):
    """Coordinate shared presence leases without turning Redis into business logic."""

    @abstractmethod
    async def renew_websocket(
        self,
        ride_id: uuid.UUID,
        connection_id: uuid.UUID,
    ) -> float:
        """Renew a connection and return the seconds until its safe cancellation."""

    @abstractmethod
    async def disconnect_websocket(
        self,
        ride_id: uuid.UUID,
        connection_id: uuid.UUID,
    ) -> float:
        """Close only that lease and return the remaining global deadline."""

    @abstractmethod
    async def renew_http(self, ride_id: uuid.UUID) -> float:
        """Record the HTTP heartbeat and return its remaining grace."""

    @abstractmethod
    async def observe(self, ride_id: uuid.UUID) -> PassengerPresenceObservation:
        """Check leases and grace using an atomic cut of the transport."""

    @abstractmethod
    async def present_ride_ids(
        self,
        ride_ids: Sequence[uuid.UUID],
    ) -> set[uuid.UUID]:
        """Return which requests remain visible under a lease or grace."""


class ScheduledActionsOperationalReader(ABC):
    """Lee agregados sanitizados del backlog de acciones programadas."""

    @abstractmethod
    async def read(
        self,
        now: datetime,
        stale_before: datetime,
    ) -> ScheduledActionsOperationalState:
        """Cuenta acciones vencidas, leases y terminales bajo un corte corto."""


class TerminalScheduledActionsRetention(ABC):
    """Delete succeeded or cancelled actions after their retention."""

    @abstractmethod
    async def purge(
        self,
        cutoff: datetime,
        action_limit: int,
    ) -> int:
        """Mark a bounded chunk for deletion and return how many rows it deleted."""


class MissingScheduledActionsReconciler(ABC):
    """Repair legacy aggregates that do not have their durable action yet."""

    @abstractmethod
    async def reconcile(self, action_limit: int) -> int:
        """Schedule a chunk of missing actions and return how many it created."""


class RealtimeOutbox(ABC):
    """Transactional persistence and claiming of realtime events."""

    @abstractmethod
    async def add_batch(
        self,
        events: Sequence[PendingRealtimeEvent],
    ) -> list[RealtimeOutboxEvent]:
        """Append a batch and assign aggregate and stream versions."""

    @abstractmethod
    async def claim_next_batch(self, now: datetime) -> list[RealtimeOutboxEvent]:
        """Lock and return the next batch ready to be published."""

    @abstractmethod
    async def mark_batch_published(
        self,
        batch_id: uuid.UUID,
        published_at: datetime,
    ) -> None:
        """Marca como publicado un lote reclamado."""

    @abstractmethod
    async def mark_batch_failed(
        self,
        batch_id: uuid.UUID,
        error: str,
        next_attempt_at: datetime,
    ) -> None:
        """Record the failure and schedule the batch's next attempt."""

    @abstractmethod
    async def mark_batch_quarantined(
        self,
        batch_id: uuid.UUID,
        code: RealtimeOutboxQuarantineCode,
        quarantined_at: datetime,
    ) -> int:
        """Terminally set aside an invalid batch that is still pending.

        Return the number of rows that made the transition. The operation
        is idempotent and never revives published or set-aside batches.
        """


class RealtimeOutboxOperationalReader(ABC):
    """Read port to observe the durable health of the outbox."""

    @abstractmethod
    async def read(self) -> RealtimeOutboxOperationalState:
        """Devuelve conteos y timestamps sin exponer modelos ORM."""


class PublishedRealtimeOutboxRetention(ABC):
    """Delete only published, complete and old batches."""

    @abstractmethod
    async def purge(
        self,
        cutoff: datetime,
        batch_limit: int,
    ) -> PublishedRealtimeOutboxRetentionResult:
        """Mark up to ``batch_limit`` complete batches for deletion."""


class RealtimeSnapshotReader(ABC):
    """Capture projections and watermarks under a single read cut.

    The concrete adapter owns the session and the consistent transaction.
    Streams are always decided by the use case so that authorization or
    routing rules do not move into the infrastructure.
    """

    @abstractmethod
    async def read_passenger(
        self,
        ride_id: uuid.UUID,
        streams: Sequence[str],
    ) -> PassengerRealtimeSnapshot | None:
        """Capture the ride, offers and positions, or ``None`` if the ride disappeared."""

    @abstractmethod
    async def read_driver(
        self,
        driver_id: uuid.UUID,
        streams: Sequence[str],
    ) -> DriverRealtimeSnapshot | None:
        """Capture the driver's state, or ``None`` if it no longer exists."""


class RealtimeOutboxBatchValidator(ABC):
    """Validate metadata and payloads before dispatching a durable batch."""

    @abstractmethod
    def validate(self, events: Sequence[RealtimeOutboxEvent]) -> None:
        """Raise an application error if the batch is not canonical."""


class RealtimeOutboxBatchPublisher(ABC):
    """Entrega un lote durable ya reclamado a un transporte realtime."""

    @abstractmethod
    async def publish(self, events: Sequence[RealtimeOutboxEvent]) -> None:
        """Publish the whole batch keeping its sequence order."""

    @abstractmethod
    async def force_resync(self, streams: Sequence[str]) -> None:
        """Force another snapshot on the sockets affected by a terminal gap."""


class RealtimeDeliveryBridge(RealtimeOutboxBatchPublisher):
    """Fan-out between processes and their local sockets in live mode."""

    @property
    @abstractmethod
    def running(self) -> bool:
        """Whether the subscriber loop is still running."""

    @property
    @abstractmethod
    def connected(self) -> bool:
        """Whether this process keeps its subscription to the transport."""

    @property
    @abstractmethod
    def last_error(self) -> str | None:
        """Sanitized code of the latest failure not yet recovered."""

    @abstractmethod
    async def preflight(self) -> None:
        """Check connectivity before admitting traffic."""

    @abstractmethod
    async def wait_until_ready(self, timeout_seconds: float) -> None:
        """Wait until the subscription is confirmed to receive fan-out."""

    @abstractmethod
    async def run(self) -> None:
        """Keep the subscription and reconnect until shutdown is requested."""

    @abstractmethod
    def stop(self) -> None:
        """Solicita un cierre coordinado del suscriptor."""

    @abstractmethod
    async def aclose(self) -> None:
        """Libera conexiones del transporte de forma idempotente."""


class CreateOfferEventRecorder(ABC):
    """Record the durable events produced when creating or improving an offer."""

    @abstractmethod
    async def record(self, result: CreateOfferResult) -> None:
        """Append the operation's full outcome to the outbox."""


class AcceptOfferEventRecorder(ABC):
    """Record the durable events produced when accepting an offer."""

    @abstractmethod
    async def record(self, result: AcceptOfferResult) -> None:
        """Append the acceptance's full atomic fan-out to the outbox."""


class PauseRideEventRecorder(ABC):
    """Record the durable events produced when pausing a request."""

    @abstractmethod
    async def record(self, result: RidePausedResult) -> None:
        """Append the close, withdrawals and pause notices to the outbox."""


class RepublishRideEventRecorder(ABC):
    """Record the durable events when renewing a request in the pool."""

    @abstractmethod
    async def record(self, result: RideRepublishedResult) -> None:
        """Append the passenger detail and the pool projection to the outbox."""


class CancelRideEventRecorder(ABC):
    """Record the durable events produced when cancelling a ride."""

    @abstractmethod
    async def record(self, result: CancelRideResult) -> None:
        """Append the terminal state, close and rejections to the outbox."""


class AnnounceOpenRideEventRecorder(ABC):
    """Record the presence announcement of an open request."""

    @abstractmethod
    async def record(self, detail: OpenRideDetail) -> None:
        """Append the ``ride_created`` already re-validated under lock to the outbox."""


class WithdrawOfferEventRecorder(ABC):
    """Record a driver voluntarily withdrawing their offer."""

    @abstractmethod
    async def record(self, offer: Offer) -> None:
        """Append the mutated offer's ``offer_withdrawn`` to the outbox."""


class RejectOfferEventRecorder(ABC):
    """Record the passenger explicitly rejecting an offer."""

    @abstractmethod
    async def record(self, offer: Offer) -> None:
        """Append the mutated offer's ``offer_rejected`` to the outbox."""


class ExpireOfferEventRecorder(ABC):
    """Record the durable events produced when an offer expires."""

    @abstractmethod
    async def record(self, offer: Offer) -> None:
        """Append the expired offer's ``offer_expired`` fan-out to the outbox."""


class UpdateRideStatusEventRecorder(ABC):
    """Record the durable events when a ride's status advances."""

    @abstractmethod
    async def record(self, detail: RideDetail) -> None:
        """Append the exact status seen by both participants to the outbox."""


class DriverAvailabilityEventRecorder(ABC):
    """Record the durable events when the driver's availability changes."""

    @abstractmethod
    async def record(self, result: DriverAvailabilityResult) -> None:
        """Append the withdrawals produced when going offline; going online emits nothing."""


class TokenService(ABC):
    @abstractmethod
    def create_access_token(self, user_id: uuid.UUID) -> str: ...

    @abstractmethod
    def create_refresh_token(self, user_id: uuid.UUID) -> str: ...

    @abstractmethod
    def decode_access_token(self, token: str) -> uuid.UUID:
        """Devuelve el id de usuario o lanza ``InvalidTokenError``."""

    @abstractmethod
    def decode_refresh_token(self, token: str) -> uuid.UUID:
        """Devuelve el id de usuario o lanza ``InvalidTokenError``."""


class SocialIdentityVerifier(ABC):
    """Verify an OAuth provider token and return a normalized profile."""

    provider: AuthProvider

    @abstractmethod
    async def verify(self, token: str) -> SocialProfile:
        """Validate the token against the provider or raise ``InvalidTokenError``."""


class RideReadRepository(ABC):
    """Read projections for rides, separate from their mutations.

    The concrete adapter resolves participants, accepted offer and rating
    in the same query that loads the rides. This way use cases do not
    rebuild views with one query per row.
    """

    @abstractmethod
    async def get_active_for_driver(self, driver_id: uuid.UUID) -> RideDetail | None:
        """The driver's latest active ride, enriched, or ``None``.

        The query must filter active statuses and apply ``LIMIT 1``.
        """

    @abstractmethod
    async def list_history_items(
        self,
        user_id: uuid.UUID,
        role: UserRole,
        statuses: set[RideStatus],
        cursor: PageCursor | None,
        limit: int,
    ) -> Page[RideHistoryItem]:
        """History with counterpart, price and the user's vote in one query."""

    @abstractmethod
    async def get_driver_earnings_summary(
        self,
        driver_id: uuid.UUID,
        day_start_utc: datetime,
        day_end_utc: datetime,
        recent_limit: int,
    ) -> DriverEarnings:
        """The driver's all-time/daily totals and recent breakdown."""
