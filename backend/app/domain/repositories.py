"""Puertos del dominio: interfaces que la infraestructura debe implementar.

Los casos de uso dependen de estas abstracciones, no de SQLAlchemy
(inversión de dependencias).
"""

from __future__ import annotations

import uuid
from abc import ABC, abstractmethod
from dataclasses import dataclass

from app.domain.entities import (
    AuthProvider,
    Location,
    Offer,
    RideRating,
    RideRequest,
    RideStatus,
    SavedPlace,
    ServiceType,
    User,
    UserRole,
)


@dataclass(frozen=True)
class OfferAcceptance:
    """Resultado de un despacho atómico exitoso.

    Agrega lo que el caso de uso y la capa de eventos necesitan tras asignar el
    conductor: el viaje actualizado, la oferta aceptada, el conductor, los
    ``ride_id`` de **otros** pasajeros cuyas ofertas vivas de ese conductor se
    retiraron, y los ``driver_id`` de los **otros** conductores de este viaje
    cuyas ofertas quedaron rechazadas (para avisarles que el viaje ya fue tomado).
    """

    ride: RideRequest
    accepted_offer: Offer
    driver: User
    withdrawn_ride_ids: list[uuid.UUID]
    losing_driver_ids: list[uuid.UUID]


@dataclass(frozen=True)
class RiderSummary:
    """Datos públicos del pasajero que el conductor ve en una solicitud abierta.

    ``rating`` suele ser ``None`` para pasajeros (hoy el recálculo de rating es
    solo para conductores); la UI lo omite cuando no existe. ``trips_completed``
    es el historial de viajes completados del pasajero.
    """

    full_name: str
    rating: float | None
    trips_completed: int


@dataclass(frozen=True)
class OpenRideDetail:
    """Solicitud abierta enriquecida con el resumen del pasajero, tal como la ve
    un conductor en su lista (REST y snapshot/``ride_created`` del WebSocket)."""

    ride: RideRequest
    rider: RiderSummary


class UserRepository(ABC):
    @abstractmethod
    async def get_by_id(self, user_id: uuid.UUID) -> User | None:
        """Devuelve el usuario con ese id, o ``None`` si no existe."""

    @abstractmethod
    async def get_by_email(self, email: str) -> User | None:
        """Devuelve el usuario con ese correo, o ``None`` si no existe."""

    @abstractmethod
    async def get_by_provider(self, provider: AuthProvider, provider_id: str) -> User | None:
        """Devuelve el usuario vinculado a una identidad externa, o ``None``."""

    @abstractmethod
    async def add(self, user: User) -> User:
        """Persiste un usuario nuevo y lo devuelve (con ``created_at`` poblado)."""

    @abstractmethod
    async def update(self, user: User) -> User:
        """Actualiza un usuario existente (p. ej. estado en línea) y lo devuelve."""


class RideRequestRepository(ABC):
    @abstractmethod
    async def add(self, ride: RideRequest) -> RideRequest:
        """Persiste una solicitud de viaje y la devuelve (con ``created_at``)."""

    @abstractmethod
    async def get_by_id(self, ride_id: uuid.UUID) -> RideRequest | None:
        """Devuelve la solicitud con ese id, o ``None`` si no existe."""

    @abstractmethod
    async def update(self, ride: RideRequest) -> RideRequest:
        """Actualiza una solicitud existente (estado, conductor asignado) y la devuelve."""

    @abstractmethod
    async def list_open_for_service(self, service_type: ServiceType) -> list[RideRequest]:
        """Solicitudes ``SEARCHING`` del tipo de servicio dado, de la más nueva a la más vieja."""

    @abstractmethod
    async def list_open_with_rider(self, service_type: ServiceType) -> list[OpenRideDetail]:
        """Solicitudes ``SEARCHING`` enriquecidas con el resumen del pasajero
        (nombre, rating y viajes completados), en **una sola query** (JOIN +
        conteo, sin N+1). Orden: de la más nueva a la más vieja."""

    @abstractmethod
    async def rider_summary(self, rider_id: uuid.UUID) -> RiderSummary | None:
        """Resumen público de un pasajero, o ``None`` si no existe."""

    @abstractmethod
    async def open_ride_with_rider(self, ride_id: uuid.UUID) -> OpenRideDetail | None:
        """Detalle enriquecido de una solicitud (para publicar ``ride_created`` con
        los datos del pasajero), o ``None`` si no existe."""

    @abstractmethod
    async def list_by_driver(self, driver_id: uuid.UUID) -> list[RideRequest]:
        """Viajes asignados al conductor, del más reciente al más antiguo."""

    @abstractmethod
    async def list_recent_destinations(
        self, rider_id: uuid.UUID, limit: int = 10
    ) -> list[Location]:
        """Destinos recientes y únicos del pasajero, del más nuevo al más viejo."""

    @abstractmethod
    async def list_history(
        self, user_id: uuid.UUID, role: UserRole, statuses: set[RideStatus]
    ) -> list[RideRequest]:
        """Viajes terminales del usuario (por ``rider_id`` si pasajero, ``driver_id`` si
        conductor) con estado en ``statuses``, del más reciente al más antiguo."""


class OfferRepository(ABC):
    @abstractmethod
    async def add(self, offer: Offer) -> Offer:
        """Persiste una oferta nueva y la devuelve (con ``created_at`` poblado)."""

    @abstractmethod
    async def get_by_id(self, offer_id: uuid.UUID) -> Offer | None:
        """Devuelve la oferta con ese id, o ``None`` si no existe."""

    @abstractmethod
    async def update(self, offer: Offer) -> Offer:
        """Actualiza una oferta existente (estado) y la devuelve."""

    @abstractmethod
    async def list_by_ride(self, ride_id: uuid.UUID) -> list[Offer]:
        """Ofertas de una solicitud, de la más nueva a la más antigua."""

    @abstractmethod
    async def get_active_by_driver_and_ride(
        self, ride_id: uuid.UUID, driver_id: uuid.UUID
    ) -> Offer | None:
        """Oferta viva (``PENDING``) más reciente del conductor para ese viaje, o
        ``None`` (la expiración por tiempo la decide el caso de uso)."""

    @abstractmethod
    async def reject_others(self, ride_id: uuid.UUID, keep_offer_id: uuid.UUID) -> None:
        """Marca ``REJECTED`` las ofertas ``PENDING`` del viaje salvo ``keep_offer_id``."""

    @abstractmethod
    async def reject_pending(self, ride_id: uuid.UUID) -> None:
        """Marca ``REJECTED`` todas las ofertas vivas (``PENDING``) del viaje
        (la solicitud murió o se pausó para editar)."""

    @abstractmethod
    async def accept_atomically(self, offer_id: uuid.UUID) -> OfferAcceptance | None:
        """Asigna el conductor de forma atómica al aceptar el pasajero la oferta.

        En **una sola transacción** y con bloqueo de filas (``SELECT … FOR UPDATE``
        en Postgres) re-verifica que la oferta siga ``PENDING``, que el viaje siga
        ``SEARCHING`` y que el conductor **no tenga ya un viaje activo**. Si todo
        sigue válido: marca la oferta ``ACCEPTED``, rechaza el resto de ofertas
        vivas del viaje y las demás ofertas vivas del conductor en otras
        solicitudes, asigna el conductor y pasa el viaje a ``ACCEPTED``; devuelve
        el :class:`OfferAcceptance`.

        Devuelve ``None`` si el conductor ya no está disponible o el viaje/oferta
        dejó de ser asignable (el caso de uso lo traduce a ``DriverUnavailableError``).
        """


class RatingRepository(ABC):
    @abstractmethod
    async def add(self, rating: RideRating) -> RideRating:
        """Persiste una calificación nueva y la devuelve (con ``created_at``)."""

    @abstractmethod
    async def get_by_ride_and_rater(
        self, ride_id: uuid.UUID, rater_id: uuid.UUID
    ) -> RideRating | None:
        """Devuelve la calificación que ``rater_id`` dio a ese viaje, o ``None``."""

    @abstractmethod
    async def list_by_ratee(self, ratee_id: uuid.UUID) -> list[RideRating]:
        """Calificaciones recibidas por un usuario, de la más nueva a la más antigua."""

    @abstractmethod
    async def average_for(self, ratee_id: uuid.UUID) -> float | None:
        """Promedio de las calificaciones recibidas, o ``None`` si no tiene ninguna."""


class SavedPlaceRepository(ABC):
    @abstractmethod
    async def list_by_user(self, user_id: uuid.UUID) -> list[SavedPlace]:
        """Lugares guardados del usuario, del más reciente al más antiguo."""

    @abstractmethod
    async def get_by_id(self, place_id: uuid.UUID) -> SavedPlace | None:
        """Devuelve el lugar con ese id, o ``None`` si no existe."""

    @abstractmethod
    async def add(self, place: SavedPlace) -> SavedPlace:
        """Persiste un lugar nuevo y lo devuelve (con timestamps poblados)."""

    @abstractmethod
    async def update(self, place: SavedPlace) -> SavedPlace:
        """Actualiza un lugar existente y lo devuelve."""

    @abstractmethod
    async def delete(self, place: SavedPlace) -> None:
        """Elimina el lugar."""
