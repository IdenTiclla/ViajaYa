"""Inyección de dependencias de la capa API.

Construye repositorios, servicios y casos de uso, y resuelve el usuario actual
a partir del token Bearer. Este es el único lugar donde se "cablea" la
infraestructura concreta con la aplicación.
"""

from __future__ import annotations

from typing import Annotated

from fastapi import Depends, Header
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker
from starlette.requests import HTTPConnection

from app.api.v1.realtime_outbox import (
    DisabledAcceptOfferEventRecorder,
    DisabledAnnounceOpenRideEventRecorder,
    DisabledCancelRideEventRecorder,
    DisabledCreateOfferEventRecorder,
    DisabledDriverAvailabilityEventRecorder,
    DisabledExpireOfferEventRecorder,
    DisabledPauseRideEventRecorder,
    DisabledRejectOfferEventRecorder,
    DisabledRepublishRideEventRecorder,
    DisabledUpdateRideStatusEventRecorder,
    DisabledWithdrawOfferEventRecorder,
    OutboxAcceptOfferEventRecorder,
    OutboxAnnounceOpenRideEventRecorder,
    OutboxCancelRideEventRecorder,
    OutboxCreateOfferEventRecorder,
    OutboxDriverAvailabilityEventRecorder,
    OutboxExpireOfferEventRecorder,
    OutboxPauseRideEventRecorder,
    OutboxRejectOfferEventRecorder,
    OutboxRepublishRideEventRecorder,
    OutboxUpdateRideStatusEventRecorder,
    OutboxWithdrawOfferEventRecorder,
)
from app.application.interfaces import (
    CancelRideEventRecorder,
    PassengerPresenceLeaseStore,
    RealtimeSnapshotReader,
    RepublishRideEventRecorder,
    RideReadRepository,
    SocialIdentityVerifier,
)
from app.application.managed_sessions import ManagedSessions
from app.application.social_accounts import SocialAccounts
from app.application.use_cases.accept_offer import AcceptOffer
from app.application.use_cases.announce_open_ride import AnnounceOpenRide
from app.application.use_cases.build_driver_realtime_snapshot import (
    BuildDriverRealtimeSnapshot,
)
from app.application.use_cases.build_passenger_realtime_snapshot import (
    BuildPassengerRealtimeSnapshot,
)
from app.application.use_cases.cancel_ride import CancelRide
from app.application.use_cases.cancel_ride_on_disconnect import CancelRideOnDisconnect
from app.application.use_cases.change_account_phone import ChangeAccountPhone
from app.application.use_cases.complete_account_recovery import CompleteAccountRecovery
from app.application.use_cases.complete_phone_sign_in import CompletePhoneSignIn
from app.application.use_cases.create_offer import CreateOffer
from app.application.use_cases.create_ride_request import CreateRideRequest
from app.application.use_cases.create_saved_place import CreateSavedPlace
from app.application.use_cases.delete_saved_place import DeleteSavedPlace
from app.application.use_cases.disconnect_passenger_presence import (
    DisconnectPassengerPresence,
)
from app.application.use_cases.dismiss_open_ride import DismissOpenRide
from app.application.use_cases.edit_ride import EditRide
from app.application.use_cases.execute_cancel_absent_ride_scheduled_action import (
    ExecuteCancelAbsentRideScheduledAction,
)
from app.application.use_cases.execute_expire_offer_scheduled_action import (
    ExecuteExpireOfferScheduledAction,
)
from app.application.use_cases.expire_offer import ExpireOffer
from app.application.use_cases.expire_offer_and_complete_scheduled_action import (
    ExpireOfferAndCompleteScheduledAction,
)
from app.application.use_cases.get_driver_active_ride import GetDriverActiveRide
from app.application.use_cases.get_driver_earnings import GetDriverEarnings
from app.application.use_cases.get_passenger_active_ride import GetPassengerActiveRide
from app.application.use_cases.get_pending_rating_ride import GetPendingRatingRide
from app.application.use_cases.get_realtime_outbox_operational_snapshot import (
    GetRealtimeOutboxOperationalSnapshot,
)
from app.application.use_cases.get_ride import GetRide
from app.application.use_cases.get_scheduled_actions_operational_snapshot import (
    GetScheduledActionsOperationalSnapshot,
)
from app.application.use_cases.list_driver_vehicles import ListDriverVehicles
from app.application.use_cases.list_offers_for_ride import ListOffersForRide
from app.application.use_cases.list_open_rides import ListOpenRides
from app.application.use_cases.list_recent_destinations import ListRecentDestinations
from app.application.use_cases.list_ride_history import ListRideHistory
from app.application.use_cases.list_saved_places import ListSavedPlaces
from app.application.use_cases.manage_account_sessions import ManageAccountSessions
from app.application.use_cases.pause_ride_for_edit import PauseRideForEdit
from app.application.use_cases.rate_ride import RateRide
from app.application.use_cases.refresh_managed_session import RefreshManagedSession
from app.application.use_cases.register_driver_vehicle import RegisterDriverVehicle
from app.application.use_cases.reject_offer import RejectOffer
from app.application.use_cases.remove_driver_vehicle import RemoveDriverVehicle
from app.application.use_cases.renew_passenger_presence import RenewPassengerPresence
from app.application.use_cases.request_account_recovery import RequestAccountRecovery
from app.application.use_cases.request_phone_code import RequestPhoneCode
from app.application.use_cases.set_driver_online import SetDriverOnline
from app.application.use_cases.sign_in_with_social import SignInWithSocial
from app.application.use_cases.skip_ride_rating import SkipRideRating
from app.application.use_cases.switch_account_mode import SwitchAccountMode
from app.application.use_cases.update_ride_fare import UpdateRideFare
from app.application.use_cases.update_ride_status import UpdateRideStatus
from app.application.use_cases.update_saved_place import UpdateSavedPlace
from app.application.use_cases.verify_phone_code import VerifyPhoneCode
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
from app.infrastructure.db.account_access import (
    SqlAlchemyPhoneAccountRepository,
    SqlAlchemySessionRepository,
)
from app.infrastructure.db.account_recovery import SqlAlchemyRecoveryRepository
from app.infrastructure.db.clock import database_utc_now
from app.infrastructure.db.driver_vehicles import SqlAlchemyDriverVehicleRepository
from app.infrastructure.db.outbox import SqlAlchemyRealtimeOutbox
from app.infrastructure.db.outbox_observability import (
    SqlAlchemyRealtimeOutboxOperationalReader,
)
from app.infrastructure.db.phone_challenges import SqlAlchemyPhoneChallengeStore
from app.infrastructure.db.realtime_snapshots import SqlAlchemyRealtimeSnapshotReader
from app.infrastructure.db.repositories import (
    SqlAlchemyOfferRepository,
    SqlAlchemyPendingRatingRepository,
    SqlAlchemyRatingRepository,
    SqlAlchemyRatingSkipRepository,
    SqlAlchemyRideReadRepository,
    SqlAlchemyRideRequestRepository,
    SqlAlchemySavedPlaceRepository,
    SqlAlchemyUserRepository,
)
from app.infrastructure.db.scheduled_actions import (
    SqlAlchemyScheduledActionRepository,
)
from app.infrastructure.db.scheduled_actions_observability import (
    SqlAlchemyScheduledActionsOperationalReader,
)
from app.infrastructure.db.session import async_session_factory, get_session
from app.infrastructure.db.social_identities import SqlAlchemySocialIdentityRepository
from app.infrastructure.db.unit_of_work import SqlAlchemyUnitOfWork
from app.infrastructure.oauth.facebook_verifier import FacebookIdentityVerifier
from app.infrastructure.oauth.google_verifier import GoogleIdentityVerifier
from app.infrastructure.security.jwt_service import JwtTokenService
from app.infrastructure.security.phone_verification import (
    HmacPhoneVerificationSecrets,
    LibPhoneNumberNormalizer,
)

SettingsDep = Annotated[Settings, Depends(get_settings)]
SessionDep = Annotated[AsyncSession, Depends(get_session)]


def get_session_factory() -> async_sessionmaker[AsyncSession]:
    """Fábrica de sesiones para conexiones WebSocket (sesión corta por handshake).

    Los endpoints WS no usan ``get_session`` (que ata la sesión al ciclo de un
    request HTTP): abren una sesión breve para autenticar y armar el snapshot, y
    la cierran antes de quedarse escuchando. Se inyecta como dependencia para
    poder sustituirla en tests por la BD en memoria.
    """
    return async_session_factory


SessionFactoryDep = Annotated[
    async_sessionmaker[AsyncSession],
    Depends(get_session_factory),
]


def get_passenger_presence_lease_store(
    connection: HTTPConnection,
) -> PassengerPresenceLeaseStore | None:
    """Expone la instancia creada por el lifespan tanto a HTTP como a WS."""
    return connection.app.state.passenger_presence_store


PassengerPresenceLeaseStoreDep = Annotated[
    PassengerPresenceLeaseStore | None,
    Depends(get_passenger_presence_lease_store),
]


def get_realtime_snapshot_reader(
    session_factory: SessionFactoryDep,
) -> RealtimeSnapshotReader:
    """Reader dueño de una sesión corta y consistente por snapshot."""
    return SqlAlchemyRealtimeSnapshotReader(session_factory)


RealtimeSnapshotReaderDep = Annotated[
    RealtimeSnapshotReader,
    Depends(get_realtime_snapshot_reader),
]


def get_realtime_outbox_operational_snapshot(
    session: SessionDep,
) -> GetRealtimeOutboxOperationalSnapshot:
    return GetRealtimeOutboxOperationalSnapshot(
        SqlAlchemyRealtimeOutboxOperationalReader(session)
    )


RealtimeOutboxOperationalSnapshotDep = Annotated[
    GetRealtimeOutboxOperationalSnapshot,
    Depends(get_realtime_outbox_operational_snapshot),
]


def get_scheduled_actions_operational_snapshot(
    session: SessionDep,
) -> GetScheduledActionsOperationalSnapshot:
    return GetScheduledActionsOperationalSnapshot(
        SqlAlchemyScheduledActionsOperationalReader(session)
    )


ScheduledActionsOperationalSnapshotDep = Annotated[
    GetScheduledActionsOperationalSnapshot,
    Depends(get_scheduled_actions_operational_snapshot),
]


def get_user_repository(session: SessionDep) -> UserRepository:
    return SqlAlchemyUserRepository(session)


UserRepositoryDep = Annotated[UserRepository, Depends(get_user_repository)]


def get_ride_request_repository(session: SessionDep) -> RideRequestRepository:
    return SqlAlchemyRideRequestRepository(session)


RideRequestRepositoryDep = Annotated[RideRequestRepository, Depends(get_ride_request_repository)]


def get_ride_read_repository(session: SessionDep) -> RideReadRepository:
    return SqlAlchemyRideReadRepository(session)


RideReadRepositoryDep = Annotated[RideReadRepository, Depends(get_ride_read_repository)]


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


def get_oauth_verifiers(settings: SettingsDep) -> dict[str, SocialIdentityVerifier]:
    verifiers: dict[str, SocialIdentityVerifier] = {}
    if settings.google_client_id:
        verifiers[AuthProvider.GOOGLE.value] = GoogleIdentityVerifier(settings.google_client_id)
    if settings.facebook_app_id and settings.facebook_app_secret:
        verifiers[AuthProvider.FACEBOOK.value] = FacebookIdentityVerifier(
            settings.facebook_app_id, settings.facebook_app_secret
        )
    return verifiers


def get_social_accounts(
    session: SessionDep, users: UserRepositoryDep,
    verifiers: Annotated[dict[str, SocialIdentityVerifier], Depends(get_oauth_verifiers)],
) -> SocialAccounts:
    return SocialAccounts(SqlAlchemySocialIdentityRepository(session), users, verifiers)


SocialAccountsDep = Annotated[SocialAccounts, Depends(get_social_accounts)]


def get_sign_in_with_social(
    session: SessionDep, access: ManagedSessionsDep, social: SocialAccountsDep,
) -> SignInWithSocial:
    return SignInWithSocial(social, access, SqlAlchemyUnitOfWork(session))


# --- Casos de uso ---


def get_build_passenger_realtime_snapshot(
    snapshots: RealtimeSnapshotReaderDep,
) -> BuildPassengerRealtimeSnapshot:
    return BuildPassengerRealtimeSnapshot(snapshots)


def get_build_driver_realtime_snapshot(
    snapshots: RealtimeSnapshotReaderDep,
) -> BuildDriverRealtimeSnapshot:
    return BuildDriverRealtimeSnapshot(snapshots)


def get_request_phone_code(session: SessionDep, settings: SettingsDep) -> RequestPhoneCode:
    return RequestPhoneCode(
        SqlAlchemyPhoneChallengeStore(session),
        LibPhoneNumberNormalizer(settings.phone_otp_allowed_regions),
        HmacPhoneVerificationSecrets(settings.jwt_secret, settings.app_env),
        mock_enabled=(settings.phone_otp_enabled and settings.app_env != "production"
                      and settings.otp_mode == "mock"),
        expose_test_code=settings.app_env != "production" and settings.otp_test_autofill,
        ttl_seconds=settings.phone_otp_ttl_seconds,
    )


def get_verify_phone_code(session: SessionDep, settings: SettingsDep) -> VerifyPhoneCode:
    return VerifyPhoneCode(
        SqlAlchemyPhoneChallengeStore(session),
        LibPhoneNumberNormalizer(settings.phone_otp_allowed_regions),
        HmacPhoneVerificationSecrets(settings.jwt_secret, settings.app_env),
        mock_enabled=(settings.phone_otp_enabled and settings.app_env != "production"
                      and settings.otp_mode == "mock"),
    )


def build_managed_sessions(session: AsyncSession, settings: Settings) -> ManagedSessions:
    return ManagedSessions(
        SqlAlchemySessionRepository(session), SqlAlchemyPhoneAccountRepository(session),
        SqlAlchemyUserRepository(session), JwtTokenService(settings),
        access_minutes=settings.access_token_expire_minutes,
        refresh_days=settings.refresh_token_expire_days,
    )


def get_managed_sessions(session: SessionDep, settings: SettingsDep) -> ManagedSessions:
    return build_managed_sessions(session, settings)


ManagedSessionsDep = Annotated[ManagedSessions, Depends(get_managed_sessions)]


def get_refresh_token(session: SessionDep, access: ManagedSessionsDep) -> RefreshManagedSession:
    return RefreshManagedSession(access, SqlAlchemyUnitOfWork(session))


def get_complete_phone_sign_in(
    session: SessionDep, settings: SettingsDep, access: ManagedSessionsDep,
    social: SocialAccountsDep,
) -> CompletePhoneSignIn:
    return CompletePhoneSignIn(
        access, SqlAlchemyPhoneChallengeStore(session),
        HmacPhoneVerificationSecrets(settings.jwt_secret, settings.app_env),
        LibPhoneNumberNormalizer(settings.phone_otp_allowed_regions),
        SqlAlchemyUnitOfWork(session),
        enabled=(settings.phone_otp_enabled and settings.app_env != "production"
                 and settings.otp_mode == "mock"),
        terms_version=settings.phone_terms_version,
        social=social,
    )


def get_manage_account_sessions(
    session: SessionDep, access: ManagedSessionsDep,
) -> ManageAccountSessions:
    return ManageAccountSessions(access, SqlAlchemyUnitOfWork(session))


def get_change_account_phone(
    session: SessionDep, settings: SettingsDep, access: ManagedSessionsDep,
) -> ChangeAccountPhone:
    return ChangeAccountPhone(
        access, SqlAlchemyPhoneChallengeStore(session),
        LibPhoneNumberNormalizer(settings.phone_otp_allowed_regions),
        HmacPhoneVerificationSecrets(settings.jwt_secret, settings.app_env),
        SqlAlchemyUnitOfWork(session),
    )


def get_request_account_recovery(
    session: SessionDep, settings: SettingsDep, access: ManagedSessionsDep,
) -> RequestAccountRecovery:
    return RequestAccountRecovery(
        access.accounts, SqlAlchemyRecoveryRepository(session),
        SqlAlchemyPhoneChallengeStore(session),
        HmacPhoneVerificationSecrets(settings.jwt_secret, settings.app_env),
        SqlAlchemyUnitOfWork(session),
    )


def get_complete_account_recovery(
    session: SessionDep, settings: SettingsDep, access: ManagedSessionsDep,
) -> CompleteAccountRecovery:
    return CompleteAccountRecovery(
        access, SqlAlchemyRecoveryRepository(session), SqlAlchemyPhoneChallengeStore(session),
        HmacPhoneVerificationSecrets(settings.jwt_secret, settings.app_env),
        SqlAlchemyUnitOfWork(session),
    )


def get_create_ride_request(
    session: SessionDep,
    settings: SettingsDep,
) -> CreateRideRequest:
    scheduled_actions = (
        SqlAlchemyScheduledActionRepository(session)
        if settings.realtime_shared_presence_enabled
        else None
    )
    return CreateRideRequest(
        SqlAlchemyRideRequestRepository(session, commit_add=False),
        SqlAlchemyUnitOfWork(session),
        scheduled_actions,
        passenger_presence_grace_seconds=(
            settings.realtime_presence_grace_seconds
        ),
    )


def get_list_recent_destinations(rides: RideRequestRepositoryDep) -> ListRecentDestinations:
    return ListRecentDestinations(rides)


def get_list_open_rides(rides: RideRequestRepositoryDep) -> ListOpenRides:
    return ListOpenRides(rides)


def get_dismiss_open_ride(rides: RideRequestRepositoryDep) -> DismissOpenRide:
    return DismissOpenRide(rides)


def get_create_offer(
    rides: RideRequestRepositoryDep,
    session: SessionDep,
    settings: SettingsDep,
) -> CreateOffer:
    offers = SqlAlchemyOfferRepository(session, commit_create_or_supersede=False)
    recorder = (
        OutboxCreateOfferEventRecorder(SqlAlchemyRealtimeOutbox(session))
        if settings.realtime_outbox_recording_enabled
        else DisabledCreateOfferEventRecorder()
    )
    return CreateOffer(
        rides,
        offers,
        SqlAlchemyUnitOfWork(session),
        recorder,
        SqlAlchemyScheduledActionRepository(session),
    )


def get_list_offers_for_ride(
    rides: RideRequestRepositoryDep,
    offers: OfferRepositoryDep,
    users: UserRepositoryDep,
) -> ListOffersForRide:
    return ListOffersForRide(rides, offers, users)


def get_accept_offer(
    rides: RideRequestRepositoryDep,
    session: SessionDep,
    settings: SettingsDep,
) -> AcceptOffer:
    offers = SqlAlchemyOfferRepository(session, commit_accept=False)
    recorder = (
        OutboxAcceptOfferEventRecorder(SqlAlchemyRealtimeOutbox(session))
        if settings.realtime_outbox_recording_enabled
        else DisabledAcceptOfferEventRecorder()
    )
    return AcceptOffer(
        rides,
        offers,
        SqlAlchemyUnitOfWork(session),
        recorder,
        clock=lambda: database_utc_now(session),
    )


def get_withdraw_offer(
    session: SessionDep,
    settings: SettingsDep,
) -> WithdrawOffer:
    recorder = (
        OutboxWithdrawOfferEventRecorder(SqlAlchemyRealtimeOutbox(session))
        if settings.realtime_outbox_recording_enabled
        else DisabledWithdrawOfferEventRecorder()
    )
    return WithdrawOffer(
        SqlAlchemyOfferRepository(session, commit_reject_if_pending=False),
        SqlAlchemyUnitOfWork(session),
        recorder,
    )


def get_reject_offer(
    rides: RideRequestRepositoryDep,
    session: SessionDep,
    settings: SettingsDep,
) -> RejectOffer:
    recorder = (
        OutboxRejectOfferEventRecorder(SqlAlchemyRealtimeOutbox(session))
        if settings.realtime_outbox_recording_enabled
        else DisabledRejectOfferEventRecorder()
    )
    return RejectOffer(
        rides,
        SqlAlchemyOfferRepository(session, commit_reject_if_pending=False),
        SqlAlchemyUnitOfWork(session),
        recorder,
    )


def build_expire_offer(session: AsyncSession, settings: Settings) -> ExpireOffer:
    """Cablea la expiración usada por tareas y handshakes fuera de HTTP DI."""
    recorder = (
        OutboxExpireOfferEventRecorder(SqlAlchemyRealtimeOutbox(session))
        if settings.realtime_outbox_recording_enabled
        else DisabledExpireOfferEventRecorder()
    )
    return ExpireOffer(
        SqlAlchemyOfferRepository(
            session,
            commit_mark_expired_if_pending=False,
        ),
        SqlAlchemyUnitOfWork(session),
        recorder,
    )


def build_expire_offer_and_complete_scheduled_action(
    session: AsyncSession,
    settings: Settings,
) -> ExpireOfferAndCompleteScheduledAction:
    """Cablea timer/barrido legacy con el ack durable en la misma UoW."""
    recorder = (
        OutboxExpireOfferEventRecorder(SqlAlchemyRealtimeOutbox(session))
        if settings.realtime_outbox_recording_enabled
        else DisabledExpireOfferEventRecorder()
    )
    return ExpireOfferAndCompleteScheduledAction(
        SqlAlchemyOfferRepository(
            session,
            commit_mark_expired_if_pending=False,
        ),
        SqlAlchemyScheduledActionRepository(session),
        SqlAlchemyUnitOfWork(session),
        recorder,
    )


def build_execute_expire_offer_scheduled_action(
    session: AsyncSession,
    settings: Settings,
) -> ExecuteExpireOfferScheduledAction:
    """Cablea expiración y ack durable sobre una única sesión/UoW."""
    recorder = (
        OutboxExpireOfferEventRecorder(SqlAlchemyRealtimeOutbox(session))
        if settings.realtime_outbox_recording_enabled
        else DisabledExpireOfferEventRecorder()
    )
    actions = SqlAlchemyScheduledActionRepository(session)
    return ExecuteExpireOfferScheduledAction(
        SqlAlchemyOfferRepository(
            session,
            commit_mark_expired_if_pending=False,
        ),
        actions,
        SqlAlchemyUnitOfWork(session),
        recorder,
    )


def build_execute_cancel_absent_ride_scheduled_action(
    session: AsyncSession,
    settings: Settings,
    leases: PassengerPresenceLeaseStore,
) -> ExecuteCancelAbsentRideScheduledAction:
    """Cablea presencia Redis, cierre de búsqueda, outbox y ack en una UoW."""
    actions = SqlAlchemyScheduledActionRepository(session)
    return ExecuteCancelAbsentRideScheduledAction(
        SqlAlchemyOfferRepository(session, commit_cancel=False),
        SqlAlchemyUserRepository(session),
        actions,
        SqlAlchemyUnitOfWork(session),
        _cancel_ride_recorder(session, settings),
        leases,
        unavailable_recheck_seconds=settings.realtime_presence_recheck_seconds,
    )


def build_renew_passenger_presence(
    session: AsyncSession,
    leases: PassengerPresenceLeaseStore,
) -> RenewPassengerPresence:
    """Cablea lease Redis y generación durable en una transacción corta."""
    return RenewPassengerPresence(
        leases,
        SqlAlchemyScheduledActionRepository(session),
        SqlAlchemyUnitOfWork(session),
    )


def build_disconnect_passenger_presence(
    session: AsyncSession,
    leases: PassengerPresenceLeaseStore,
) -> DisconnectPassengerPresence:
    """Cablea la desconexión de un lease y su nueva generación durable."""
    return DisconnectPassengerPresence(
        leases,
        SqlAlchemyScheduledActionRepository(session),
        SqlAlchemyUnitOfWork(session),
    )


def get_update_ride_status(
    session: SessionDep,
    settings: SettingsDep,
) -> UpdateRideStatus:
    recorder = (
        OutboxUpdateRideStatusEventRecorder(SqlAlchemyRealtimeOutbox(session))
        if settings.realtime_outbox_recording_enabled
        else DisabledUpdateRideStatusEventRecorder()
    )
    return UpdateRideStatus(
        SqlAlchemyRideRequestRepository(session, commit_update_if_state=False),
        SqlAlchemyOfferRepository(session),
        SqlAlchemyUserRepository(session),
        SqlAlchemyUnitOfWork(session),
        recorder,
    )


def _republish_ride_recorder(
    session: AsyncSession,
    settings: Settings,
) -> RepublishRideEventRecorder:
    return (
        OutboxRepublishRideEventRecorder(SqlAlchemyRealtimeOutbox(session))
        if settings.realtime_outbox_recording_enabled
        else DisabledRepublishRideEventRecorder()
    )


def get_update_ride_fare(
    session: SessionDep,
    settings: SettingsDep,
) -> UpdateRideFare:
    return UpdateRideFare(
        SqlAlchemyRideRequestRepository(session, commit_update_if_state=False),
        SqlAlchemyUnitOfWork(session),
        _republish_ride_recorder(session, settings),
    )


def _cancel_ride_recorder(
    session: AsyncSession,
    settings: Settings,
) -> CancelRideEventRecorder:
    return (
        OutboxCancelRideEventRecorder(SqlAlchemyRealtimeOutbox(session))
        if settings.realtime_outbox_recording_enabled
        else DisabledCancelRideEventRecorder()
    )


def get_cancel_ride(
    rides: RideRequestRepositoryDep,
    users: UserRepositoryDep,
    session: SessionDep,
    settings: SettingsDep,
) -> CancelRide:
    return CancelRide(
        rides,
        SqlAlchemyOfferRepository(session, commit_cancel=False),
        users,
        SqlAlchemyUnitOfWork(session),
        _cancel_ride_recorder(session, settings),
    )


def build_cancel_ride_on_disconnect(
    session: AsyncSession,
    settings: Settings,
) -> CancelRideOnDisconnect:
    """Cablea el cierre de presencia sobre una única sesión/UoW."""
    return CancelRideOnDisconnect(
        SqlAlchemyOfferRepository(session, commit_cancel=False),
        SqlAlchemyUserRepository(session),
        SqlAlchemyUnitOfWork(session),
        _cancel_ride_recorder(session, settings),
    )


def build_announce_open_ride(
    session: AsyncSession,
    settings: Settings,
) -> AnnounceOpenRide:
    """Cablea el anuncio de presencia sobre una única sesión/UoW."""
    recorder = (
        OutboxAnnounceOpenRideEventRecorder(SqlAlchemyRealtimeOutbox(session))
        if settings.realtime_outbox_recording_enabled
        else DisabledAnnounceOpenRideEventRecorder()
    )
    return AnnounceOpenRide(
        SqlAlchemyRideRequestRepository(session),
        SqlAlchemyUnitOfWork(session),
        recorder,
    )


def get_pause_ride_for_edit(
    rides: RideRequestRepositoryDep,
    session: SessionDep,
    settings: SettingsDep,
) -> PauseRideForEdit:
    offers = SqlAlchemyOfferRepository(session, commit_pause=False)
    recorder = (
        OutboxPauseRideEventRecorder(SqlAlchemyRealtimeOutbox(session))
        if settings.realtime_outbox_recording_enabled
        else DisabledPauseRideEventRecorder()
    )
    return PauseRideForEdit(
        rides,
        offers,
        SqlAlchemyUnitOfWork(session),
        recorder,
    )


def get_edit_ride(
    session: SessionDep,
    settings: SettingsDep,
) -> EditRide:
    return EditRide(
        SqlAlchemyRideRequestRepository(session, commit_update_if_state=False),
        SqlAlchemyUnitOfWork(session),
        _republish_ride_recorder(session, settings),
    )


def get_set_driver_online(
    session: SessionDep,
    settings: SettingsDep,
) -> SetDriverOnline:
    recorder = (
        OutboxDriverAvailabilityEventRecorder(SqlAlchemyRealtimeOutbox(session))
        if settings.realtime_outbox_recording_enabled
        else DisabledDriverAvailabilityEventRecorder()
    )
    return SetDriverOnline(
        SqlAlchemyUserRepository(session, commit_set_online=False),
        SqlAlchemyOfferRepository(session, commit_set_driver_offline=False),
        SqlAlchemyUnitOfWork(session),
        recorder,
    )


def get_register_driver_vehicle(
    session: SessionDep, settings: SettingsDep
) -> RegisterDriverVehicle:
    return RegisterDriverVehicle(
        SqlAlchemyUserRepository(session),
        SqlAlchemyDriverVehicleRepository(session),
        auto_approve=settings.driver_auto_approve,
    )


def get_list_driver_vehicles(session: SessionDep) -> ListDriverVehicles:
    return ListDriverVehicles(SqlAlchemyDriverVehicleRepository(session))


def get_remove_driver_vehicle(session: SessionDep) -> RemoveDriverVehicle:
    return RemoveDriverVehicle(
        SqlAlchemyUserRepository(session),
        SqlAlchemyDriverVehicleRepository(session),
    )


def get_switch_account_mode(session: SessionDep) -> SwitchAccountMode:
    return SwitchAccountMode(
        SqlAlchemyUserRepository(session),
        SqlAlchemyRideRequestRepository(session),
        SqlAlchemyDriverVehicleRepository(session),
    )


def get_driver_active_ride(
    ride_reads: RideReadRepositoryDep,
) -> GetDriverActiveRide:
    return GetDriverActiveRide(ride_reads)


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
    ride_reads: RideReadRepositoryDep,
) -> ListRideHistory:
    return ListRideHistory(ride_reads)


def get_get_driver_earnings(ride_reads: RideReadRepositoryDep) -> GetDriverEarnings:
    return GetDriverEarnings(ride_reads)


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
    access: ManagedSessionsDep,
    authorization: Annotated[str | None, Header()] = None,
) -> User:
    from app.api.errors import unauthorized

    if not authorization or not authorization.lower().startswith("bearer "):
        raise unauthorized("Falta el token de autorización")
    token = authorization.split(" ", 1)[1].strip()
    try:
        user, _ = await access.authenticate(token)
    except InvalidTokenError as exc:
        raise unauthorized("Token inválido o expirado") from exc

    return user


CurrentUserDep = Annotated[User, Depends(get_current_user)]
