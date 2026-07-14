"""Puertos del dominio: interfaces que la infraestructura debe implementar.

Los casos de uso dependen de estas abstracciones, no de SQLAlchemy
(inversión de dependencias).
"""

from __future__ import annotations

import uuid
from abc import ABC, abstractmethod
from dataclasses import dataclass
from decimal import Decimal

from app.domain.entities import (
    AuthProvider,
    Location,
    Offer,
    RideRating,
    RideRatingSkip,
    RideRequest,
    RideStatus,
    SavedPlace,
    User,
    UserRole,
    VehicleType,
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
class OfferCreation:
    """Alta o reemplazo atómico de una oferta."""

    offer: Offer
    superseded_offer_id: uuid.UUID | None = None


@dataclass(frozen=True)
class DriverOfflineTransition:
    """Conductor desconectado y ofertas pendientes retiradas en un solo commit."""

    driver: User
    withdrawn_offers: list[Offer]


@dataclass(frozen=True)
class RideAutoCancellation:
    """Cierre atómico de una búsqueda abandonada y sus ofertas vivas."""

    ride: RideRequest
    cancelled_offers: list[Offer]


@dataclass(frozen=True)
class RideOffersTransition:
    """Mutación atómica de un viaje y las ofertas vivas afectadas por ella."""

    ride: RideRequest
    affected_offers: list[Offer]


@dataclass(frozen=True)
class RiderSummary:
    """Datos públicos del pasajero que el conductor ve en una solicitud abierta.

    ``rating`` es el promedio de las calificaciones recibidas y puede ser ``None``
    si aún no tiene votos. ``trips_completed`` cuenta su historial completado.
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
        """Actualiza los datos generales de un usuario y lo devuelve."""

    @abstractmethod
    async def set_online(self, user_id: uuid.UUID, is_online: bool) -> User:
        """Actualiza solo la disponibilidad, sin pisar otros campos concurrentes."""


class RideRequestRepository(ABC):
    @abstractmethod
    async def add(self, ride: RideRequest) -> RideRequest:
        """Persiste una solicitud de viaje y la devuelve (con ``created_at``)."""

    @abstractmethod
    async def add_if_no_active(self, ride: RideRequest) -> RideRequest | None:
        """Crea la solicitud solo si el pasajero no tiene otro viaje activo.

        La comprobación y el alta deben ejecutarse bajo una exclusión mutua sobre
        el pasajero para que dos requests concurrentes no creen dos solicitudes.
        """

    @abstractmethod
    async def get_by_id(self, ride_id: uuid.UUID) -> RideRequest | None:
        """Devuelve la solicitud con ese id, o ``None`` si no existe."""

    @abstractmethod
    async def get_active_by_rider(self, rider_id: uuid.UUID) -> RideRequest | None:
        """Viaje no terminal más reciente del pasajero, o ``None``."""

    @abstractmethod
    async def update(self, ride: RideRequest) -> RideRequest:
        """Actualiza una solicitud existente (estado, conductor asignado) y la devuelve."""

    @abstractmethod
    async def update_if_state(
        self,
        ride: RideRequest,
        expected_status: RideStatus,
        *,
        expected_paused: bool | None = None,
        expected_fare: Decimal | None = None,
    ) -> RideRequest | None:
        """Actualiza mediante compare-and-set y devuelve ``None`` si perdió la carrera.

        Siempre compara ``status``; opcionalmente compara ``paused`` y ``fare``
        para proteger mutaciones que conservan el mismo estado del viaje.
        """

    @abstractmethod
    async def cancel_if_searching(self, ride_id: uuid.UUID) -> RideRequest | None:
        """Cancela atómicamente solo un ride ``SEARCHING`` y no pausado."""

    @abstractmethod
    async def list_open_for_vehicle(self, vehicle_type: VehicleType) -> list[RideRequest]:
        """Solicitudes compatibles con el vehiculo, de la mas nueva a la mas vieja."""

    @abstractmethod
    async def list_open_with_rider_for_vehicle(
        self, vehicle_type: VehicleType, *, driver_id: uuid.UUID | None = None
    ) -> list[OpenRideDetail]:
        """Solicitudes compatibles enriquecidas con el resumen del pasajero
        (nombre, rating y viajes completados), en **una sola query** (JOIN +
        conteo, sin N+1). Si se recibe ``driver_id``, excluye las versiones que
        ese conductor ocultó. Orden: de la más nueva a la más vieja."""

    @abstractmethod
    async def dismiss_open_ride_for_driver(
        self, driver_id: uuid.UUID, ride_id: uuid.UUID, pool_version: int
    ) -> None:
        """Guarda que el conductor ocultó esta versión de la solicitud."""

    @abstractmethod
    async def list_paused_with_rider_for_driver(
        self, driver_id: uuid.UUID
    ) -> list[OpenRideDetail]:
        """Solicitudes pausadas sobre las que el conductor ya había ofertado."""

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


class PendingRatingRepository(ABC):
    """Consulta de lectura para recuperar cierres que aún requieren calificación."""

    @abstractmethod
    async def get_latest_for(
        self,
        user_id: uuid.UUID,
        role: UserRole,
    ) -> RideRequest | None:
        """Último ``COMPLETED`` del usuario sin rating emitido por él, o ``None``."""


class OfferRepository(ABC):
    @abstractmethod
    async def add(self, offer: Offer) -> Offer:
        """Persiste una oferta nueva y la devuelve (con ``created_at`` poblado)."""

    @abstractmethod
    async def create_or_supersede_atomically(
        self, offer: Offer, *, expected_ride_fare: Decimal
    ) -> OfferCreation | None:
        """Crea la oferta y reemplaza la previa bajo una sola transacción.

        Devuelve ``None`` si el conductor o el ride dejaron de ser elegibles al
        revalidarlos bajo lock.
        """

    @abstractmethod
    async def get_by_id(self, offer_id: uuid.UUID) -> Offer | None:
        """Devuelve la oferta con ese id, o ``None`` si no existe."""

    @abstractmethod
    async def update(self, offer: Offer) -> Offer:
        """Actualiza una oferta existente (estado) y la devuelve."""

    @abstractmethod
    async def reject_if_pending(self, offer_id: uuid.UUID) -> Offer | None:
        """Pasa ``PENDING`` a ``REJECTED`` mediante compare-and-set."""

    @abstractmethod
    async def list_by_ride(self, ride_id: uuid.UUID) -> list[Offer]:
        """Ofertas de una solicitud, de la más nueva a la más antigua."""

    @abstractmethod
    async def list_active_by_driver(self, driver_id: uuid.UUID) -> list[Offer]:
        """Ofertas vivas (``PENDING``) de un conductor, de la más nueva a la más vieja."""

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
    async def set_driver_offline_atomically(
        self, driver_id: uuid.UUID
    ) -> DriverOfflineTransition | None:
        """Desconecta al conductor y retira sus ofertas en una transacción.

        Debe bloquear primero al conductor, rechazar el cambio si ya tiene un viaje
        activo y serializarse contra creación/aceptación de ofertas. Devuelve las
        ofertas no expiradas para publicar su retiro a los pasajeros.
        """

    @abstractmethod
    async def cancel_ride_atomically(
        self,
        ride_id: uuid.UUID,
        *,
        expected_status: RideStatus,
        expected_paused: bool,
    ) -> RideOffersTransition | None:
        """Cancela el viaje y rechaza sus ofertas ``PENDING`` en un solo commit.

        Debe bloquear el viaje y revalidar su estado y pausa contra el snapshot
        esperado antes de mutar cualquier fila.
        """

    @abstractmethod
    async def pause_ride_atomically(
        self,
        ride_id: uuid.UUID,
        *,
        expected_fare: Decimal,
    ) -> RideOffersTransition | None:
        """Pausa un viaje ``SEARCHING`` y rechaza sus ofertas en un solo commit.

        Debe revalidar bajo lock que siga sin pausa y conserve ``expected_fare``.
        """

    @abstractmethod
    async def cancel_ride_on_disconnect_atomically(
        self, ride_id: uuid.UUID
    ) -> RideAutoCancellation | None:
        """Cancela una búsqueda abandonada y rechaza sus ofertas en una transacción.

        Debe bloquear y revalidar que el viaje siga ``SEARCHING`` y no pausado.
        Devuelve las ofertas que seguían vivas al cerrarse para emitir sus eventos.
        """

    @abstractmethod
    async def accept_atomically(self, offer_id: uuid.UUID) -> OfferAcceptance | None:
        """Asigna el conductor de forma atómica al aceptar el pasajero la oferta.

        En **una sola transacción** y con bloqueo de filas (``SELECT … FOR UPDATE``
        en Postgres) re-verifica que la oferta siga ``PENDING``, que el viaje siga
        ``SEARCHING`` y que el conductor siga en línea, habilitado y **sin un viaje
        activo**. Si todo sigue válido: marca la oferta ``ACCEPTED``, rechaza el resto
        de ofertas
        vivas del viaje y las demás ofertas vivas del conductor en otras
        solicitudes, asigna el conductor y pasa el viaje a ``ACCEPTED``; devuelve
        el :class:`OfferAcceptance`.

        Devuelve ``None`` si el conductor ya no está disponible o el viaje/oferta
        dejó de ser asignable (el caso de uso lo traduce a ``DriverUnavailableError``).
        """

    @abstractmethod
    async def mark_expired_if_pending(self, offer_id: uuid.UUID) -> Offer | None:
        """Vence la oferta (``EXPIRED``) solo si sigue ``PENDING`` y pasó su TTL.

        Devuelve la oferta ya ``EXPIRED``, o ``None`` si ya no era ``PENDING`` o no
        estaba vencida (race-safe contra accept/reject/withdraw/supersede: esos la
        sacan de ``PENDING`` y aquí no se toca). Así el backend puede avisar al
        conductor en tiempo real cuando su oferta muere por tiempo.
        """


class RatingRepository(ABC):
    @abstractmethod
    async def add_and_recompute(self, rating: RideRating) -> RideRating | None:
        """Persiste el voto y actualiza el promedio del calificado atómicamente.

        Implementaciones transaccionales deben serializar las calificaciones del
        mismo ``ratee_id`` y escribir exclusivamente ``User.rating``. Devuelve
        ``None`` cuando ya existe un voto del mismo autor para el viaje.
        """

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


class RatingSkipRepository(ABC):
    @abstractmethod
    async def get_by_ride_and_rater(
        self,
        ride_id: uuid.UUID,
        rater_id: uuid.UUID,
    ) -> RideRatingSkip | None:
        """Devuelve la omisión del participante, o ``None`` si todavía no existe."""

    @abstractmethod
    async def add_if_absent(self, skip: RideRatingSkip) -> RideRatingSkip:
        """Persiste la omisión o devuelve la existente de forma idempotente."""


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
