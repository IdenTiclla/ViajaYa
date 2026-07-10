"""Inyección de dependencias de la capa API.

Construye repositorios, servicios y casos de uso, y resuelve el usuario actual
a partir del token Bearer. Este es el único lugar donde se "cablea" la
infraestructura concreta con la aplicación.
"""

from __future__ import annotations

from functools import lru_cache
from typing import Annotated

from fastapi import Depends, Header
from sqlalchemy.ext.asyncio import AsyncSession

from app.application.interfaces import SocialIdentityVerifier, TokenService
from app.application.use_cases.accept_offer import AcceptOffer
from app.application.use_cases.authenticate_user import AuthenticateUser
from app.application.use_cases.authenticate_with_oauth import AuthenticateWithOAuth
from app.application.use_cases.cancel_ride import CancelRide
from app.application.use_cases.create_offer import CreateOffer
from app.application.use_cases.create_ride_request import CreateRideRequest
from app.application.use_cases.create_saved_place import CreateSavedPlace
from app.application.use_cases.delete_saved_place import DeleteSavedPlace
from app.application.use_cases.edit_ride import EditRide
from app.application.use_cases.get_driver_active_ride import GetDriverActiveRide
from app.application.use_cases.get_driver_earnings import GetDriverEarnings
from app.application.use_cases.get_passenger_active_ride import GetPassengerActiveRide
from app.application.use_cases.get_pending_rating_ride import GetPendingRatingRide
from app.application.use_cases.get_ride import GetRide
from app.application.use_cases.list_offers_for_ride import ListOffersForRide
from app.application.use_cases.list_open_rides import ListOpenRides
from app.application.use_cases.list_recent_destinations import ListRecentDestinations
from app.application.use_cases.list_ride_history import ListRideHistory
from app.application.use_cases.list_saved_places import ListSavedPlaces
from app.application.use_cases.pause_ride_for_edit import PauseRideForEdit
from app.application.use_cases.rate_ride import RateRide
from app.application.use_cases.refresh_token import RefreshToken
from app.application.use_cases.register_user import RegisterUser
from app.application.use_cases.reject_offer import RejectOffer
from app.application.use_cases.set_driver_online import SetDriverOnline
from app.application.use_cases.skip_ride_rating import SkipRideRating
from app.application.use_cases.update_ride_fare import UpdateRideFare
from app.application.use_cases.update_ride_status import UpdateRideStatus
from app.application.use_cases.update_saved_place import UpdateSavedPlace
from app.application.use_cases.withdraw_offer import WithdrawOffer
from app.domain.entities import AuthProvider, User
from app.domain.exceptions import InvalidTokenError
from app.domain.repositories import (
    OfferRepository,
    PendingRatingRepository,
    RatingRepository,
    RatingSkipRepository,
    RideRequestRepository,
    SavedPlaceRepository,
    UserRepository,
)
from app.infrastructure.config import Settings, get_settings
from app.infrastructure.db.repositories import (
    SqlAlchemyOfferRepository,
    SqlAlchemyPendingRatingRepository,
    SqlAlchemyRatingRepository,
    SqlAlchemyRatingSkipRepository,
    SqlAlchemyRideRequestRepository,
    SqlAlchemySavedPlaceRepository,
    SqlAlchemyUserRepository,
)
from app.infrastructure.db.session import async_session_factory, get_session
from app.infrastructure.oauth.facebook_verifier import FacebookIdentityVerifier
from app.infrastructure.oauth.google_verifier import GoogleIdentityVerifier
from app.infrastructure.security.bcrypt_hasher import BcryptPasswordHasher
from app.infrastructure.security.jwt_service import JwtTokenService

SettingsDep = Annotated[Settings, Depends(get_settings)]
SessionDep = Annotated[AsyncSession, Depends(get_session)]


def get_session_factory():
    """Fábrica de sesiones para conexiones WebSocket (sesión corta por handshake).

    Los endpoints WS no usan ``get_session`` (que ata la sesión al ciclo de un
    request HTTP): abren una sesión breve para autenticar y armar el snapshot, y
    la cierran antes de quedarse escuchando. Se inyecta como dependencia para
    poder sustituirla en tests por la BD en memoria.
    """
    return async_session_factory


def get_user_repository(session: SessionDep) -> UserRepository:
    return SqlAlchemyUserRepository(session)


UserRepositoryDep = Annotated[UserRepository, Depends(get_user_repository)]


def get_ride_request_repository(session: SessionDep) -> RideRequestRepository:
    return SqlAlchemyRideRequestRepository(session)


RideRequestRepositoryDep = Annotated[RideRequestRepository, Depends(get_ride_request_repository)]


def get_saved_place_repository(session: SessionDep) -> SavedPlaceRepository:
    return SqlAlchemySavedPlaceRepository(session)


SavedPlaceRepositoryDep = Annotated[SavedPlaceRepository, Depends(get_saved_place_repository)]


def get_offer_repository(session: SessionDep) -> OfferRepository:
    return SqlAlchemyOfferRepository(session)


OfferRepositoryDep = Annotated[OfferRepository, Depends(get_offer_repository)]


def get_rating_repository(session: SessionDep) -> RatingRepository:
    return SqlAlchemyRatingRepository(session)


RatingRepositoryDep = Annotated[RatingRepository, Depends(get_rating_repository)]


def get_pending_rating_repository(session: SessionDep) -> PendingRatingRepository:
    return SqlAlchemyPendingRatingRepository(session)


PendingRatingRepositoryDep = Annotated[
    PendingRatingRepository,
    Depends(get_pending_rating_repository),
]


def get_rating_skip_repository(session: SessionDep) -> RatingSkipRepository:
    return SqlAlchemyRatingSkipRepository(session)


RatingSkipRepositoryDep = Annotated[
    RatingSkipRepository,
    Depends(get_rating_skip_repository),
]


@lru_cache
def _hasher() -> BcryptPasswordHasher:
    return BcryptPasswordHasher()


def get_token_service(settings: SettingsDep) -> TokenService:
    return JwtTokenService(settings)


TokenServiceDep = Annotated[TokenService, Depends(get_token_service)]


def get_oauth_verifiers(settings: SettingsDep) -> dict[str, SocialIdentityVerifier]:
    return {
        AuthProvider.GOOGLE.value: GoogleIdentityVerifier(settings.google_client_id),
        AuthProvider.FACEBOOK.value: FacebookIdentityVerifier(
            settings.facebook_app_id, settings.facebook_app_secret
        ),
    }


# --- Casos de uso ---


def get_register_user(users: UserRepositoryDep, tokens: TokenServiceDep) -> RegisterUser:
    return RegisterUser(users, _hasher(), tokens)


def get_authenticate_user(
    users: UserRepositoryDep, tokens: TokenServiceDep
) -> AuthenticateUser:
    return AuthenticateUser(users, _hasher(), tokens)


def get_refresh_token(tokens: TokenServiceDep) -> RefreshToken:
    return RefreshToken(tokens)


def get_authenticate_with_oauth(
    users: UserRepositoryDep,
    tokens: TokenServiceDep,
    verifiers: Annotated[dict[str, SocialIdentityVerifier], Depends(get_oauth_verifiers)],
) -> AuthenticateWithOAuth:
    return AuthenticateWithOAuth(users, tokens, verifiers)


def get_create_ride_request(rides: RideRequestRepositoryDep) -> CreateRideRequest:
    return CreateRideRequest(rides)


def get_list_recent_destinations(rides: RideRequestRepositoryDep) -> ListRecentDestinations:
    return ListRecentDestinations(rides)


def get_list_open_rides(rides: RideRequestRepositoryDep) -> ListOpenRides:
    return ListOpenRides(rides)


def get_create_offer(
    rides: RideRequestRepositoryDep, offers: OfferRepositoryDep
) -> CreateOffer:
    return CreateOffer(rides, offers)


def get_list_offers_for_ride(
    rides: RideRequestRepositoryDep,
    offers: OfferRepositoryDep,
    users: UserRepositoryDep,
) -> ListOffersForRide:
    return ListOffersForRide(rides, offers, users)


def get_accept_offer(
    rides: RideRequestRepositoryDep,
    offers: OfferRepositoryDep,
) -> AcceptOffer:
    return AcceptOffer(rides, offers)


def get_withdraw_offer(offers: OfferRepositoryDep) -> WithdrawOffer:
    return WithdrawOffer(offers)


def get_reject_offer(
    rides: RideRequestRepositoryDep,
    offers: OfferRepositoryDep,
) -> RejectOffer:
    return RejectOffer(rides, offers)


def get_update_ride_status(rides: RideRequestRepositoryDep) -> UpdateRideStatus:
    return UpdateRideStatus(rides)


def get_update_ride_fare(rides: RideRequestRepositoryDep) -> UpdateRideFare:
    return UpdateRideFare(rides)


def get_cancel_ride(
    rides: RideRequestRepositoryDep, offers: OfferRepositoryDep
) -> CancelRide:
    return CancelRide(rides, offers)


def get_pause_ride_for_edit(
    rides: RideRequestRepositoryDep, offers: OfferRepositoryDep
) -> PauseRideForEdit:
    return PauseRideForEdit(rides, offers)


def get_edit_ride(rides: RideRequestRepositoryDep) -> EditRide:
    return EditRide(rides)


def get_set_driver_online(
    users: UserRepositoryDep, offers: OfferRepositoryDep
) -> SetDriverOnline:
    return SetDriverOnline(users, offers)


def get_driver_active_ride(
    rides: RideRequestRepositoryDep,
    offers: OfferRepositoryDep,
    users: UserRepositoryDep,
) -> GetDriverActiveRide:
    return GetDriverActiveRide(rides, offers, users)


def get_passenger_active_ride(
    rides: RideRequestRepositoryDep,
    offers: OfferRepositoryDep,
    users: UserRepositoryDep,
) -> GetPassengerActiveRide:
    return GetPassengerActiveRide(rides, offers, users)


def get_pending_rating_ride(
    pending_ratings: PendingRatingRepositoryDep,
    offers: OfferRepositoryDep,
    users: UserRepositoryDep,
) -> GetPendingRatingRide:
    return GetPendingRatingRide(pending_ratings, offers, users)


def get_get_ride(
    rides: RideRequestRepositoryDep,
    offers: OfferRepositoryDep,
    users: UserRepositoryDep,
) -> GetRide:
    return GetRide(rides, offers, users)


def get_rate_ride(
    rides: RideRequestRepositoryDep,
    ratings: RatingRepositoryDep,
) -> RateRide:
    return RateRide(rides, ratings)


def get_skip_ride_rating(
    rides: RideRequestRepositoryDep,
    skips: RatingSkipRepositoryDep,
) -> SkipRideRating:
    return SkipRideRating(rides, skips)


def get_list_ride_history(
    rides: RideRequestRepositoryDep,
    offers: OfferRepositoryDep,
    users: UserRepositoryDep,
    ratings: RatingRepositoryDep,
) -> ListRideHistory:
    return ListRideHistory(rides, offers, users, ratings)


def get_get_driver_earnings(
    rides: RideRequestRepositoryDep, offers: OfferRepositoryDep
) -> GetDriverEarnings:
    return GetDriverEarnings(rides, offers)


def get_list_saved_places(places: SavedPlaceRepositoryDep) -> ListSavedPlaces:
    return ListSavedPlaces(places)


def get_create_saved_place(places: SavedPlaceRepositoryDep) -> CreateSavedPlace:
    return CreateSavedPlace(places)


def get_update_saved_place(places: SavedPlaceRepositoryDep) -> UpdateSavedPlace:
    return UpdateSavedPlace(places)


def get_delete_saved_place(places: SavedPlaceRepositoryDep) -> DeleteSavedPlace:
    return DeleteSavedPlace(places)


# --- Usuario actual ---


async def get_current_user(
    users: UserRepositoryDep,
    tokens: TokenServiceDep,
    authorization: Annotated[str | None, Header()] = None,
) -> User:
    from app.api.errors import unauthorized

    if not authorization or not authorization.lower().startswith("bearer "):
        raise unauthorized("Falta el token de autorización")
    token = authorization.split(" ", 1)[1].strip()
    try:
        user_id = tokens.decode_access_token(token)
    except InvalidTokenError as exc:
        raise unauthorized("Token inválido o expirado") from exc

    user = await users.get_by_id(user_id)
    if user is None:
        raise unauthorized("Usuario no encontrado")
    return user


CurrentUserDep = Annotated[User, Depends(get_current_user)]
