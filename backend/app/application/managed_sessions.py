"""Issue and validate device sessions using persistence and signing ports."""

from datetime import UTC, datetime, timedelta
from uuid import UUID, uuid4

from app.application.account_access import (
    ManagedSession,
    PhoneAccountRepository,
    RefreshCredential,
    SessionClaims,
    SessionGrant,
    SessionRepository,
    SessionTokenCodec,
)
from app.domain.account_access import ReauthenticationRequiredError
from app.domain.entities import User
from app.domain.exceptions import InvalidTokenError
from app.domain.repositories import UserRepository


class ManagedSessions:
    def __init__(
        self,
        sessions: SessionRepository,
        accounts: PhoneAccountRepository,
        users: UserRepository,
        tokens: SessionTokenCodec,
        *,
        access_minutes: int,
        refresh_days: int,
    ) -> None:
        self.sessions, self.accounts, self.users, self.tokens = sessions, accounts, users, tokens
        self.access_ttl = timedelta(minutes=access_minutes)
        self.refresh_ttl = timedelta(days=refresh_days)

    async def authenticate(self, access_token: str) -> tuple[User, SessionClaims]:
        claims = self.tokens.decode_access_claims(access_token)
        user = await self.users.get_by_id(claims.user_id)
        if not user or not user.is_active:
            raise InvalidTokenError("La sesión ya no está activa.")
        if claims.session_id:
            session = await self.sessions.get(claims.session_id)
            self.validate(session, claims.user_id)
        elif user.legacy_auth_disabled:
            raise InvalidTokenError("Verifica tu teléfono para iniciar sesión.")
        return user, claims

    @staticmethod
    def validate(session: ManagedSession | None, user_id: UUID) -> ManagedSession:
        if (
            not session
            or session.user_id != user_id
            or session.revoked_at
            or session.expires_at <= datetime.now(UTC)
        ):
            raise InvalidTokenError("La sesión ya no está activa.")
        return session

    async def require_recent(
        self, access_token: str, device_id: UUID
    ) -> tuple[User, ManagedSession]:
        user, claims = await self.authenticate(access_token)
        if not claims.session_id:
            raise ReauthenticationRequiredError()
        session = self.validate(await self.sessions.get(claims.session_id), user.id)
        if session.device_id != device_id or session.created_at < datetime.now(UTC) - timedelta(
            minutes=5
        ):
            raise ReauthenticationRequiredError()
        return user, session

    async def create(self, user_id: UUID, device_id: UUID, device_name: str) -> SessionGrant:
        # The account row is locked by the caller, serializing login and all-session revocation.
        now = datetime.now(UTC).replace(microsecond=0)
        await self.sessions.revoke_for_user(user_id, now, "replaced", device_id=device_id)
        session = ManagedSession(
            uuid4(), user_id, device_id, device_name, now, now, now + self.refresh_ttl
        )
        await self.sessions.add(session)
        return await self.next_grant(session)

    async def next_grant(self, session: ManagedSession) -> SessionGrant:
        now = datetime.now(UTC).replace(microsecond=0)
        credential = RefreshCredential(
            uuid4(), session.id, now, min(now + self.access_ttl, session.expires_at)
        )
        await self.sessions.add_credential(credential)
        return self.grant(session, credential)

    @staticmethod
    def grant(session: ManagedSession, credential: RefreshCredential) -> SessionGrant:
        return SessionGrant(
            session.user_id,
            session.id,
            credential.id,
            credential.issued_at,
            credential.access_expires_at,
            session.expires_at,
        )
