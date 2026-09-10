"""Rotate refresh credentials and revoke a session on confirmed credential reuse."""

from datetime import UTC, datetime, timedelta
from uuid import UUID, uuid4

from app.application.dto import TokenPair
from app.application.interfaces import TokenService, UnitOfWork
from app.application.managed_sessions import ManagedSessions
from app.application.token_issuer import issue_token_pair
from app.domain.exceptions import InvalidTokenError


class RefreshManagedSession:
    def __init__(
        self, access: ManagedSessions, uow: UnitOfWork, legacy_tokens: TokenService
    ) -> None:
        self.access, self.uow, self.legacy_tokens = access, uow, legacy_tokens

    async def execute(self, refresh_token: str, request_id: UUID | None = None) -> TokenPair:
        claims = self.access.tokens.decode_refresh_claims(refresh_token)
        user = await self.access.accounts.lock_user(claims.user_id)
        if not user or not user.is_active:
            raise InvalidTokenError("La sesión ya no está activa.")
        if not claims.session_id:
            if user.legacy_auth_disabled:
                raise InvalidTokenError("Verifica tu teléfono para iniciar sesión.")
            return issue_token_pair(self.legacy_tokens, user.id)
        session = self.access.validate(
            await self.access.sessions.get(claims.session_id, lock=True),
            user.id,
        )
        now = datetime.now(UTC)
        credential = await self.access.sessions.get_credential(claims.credential_id)
        if not credential or credential.session_id != session.id:
            raise InvalidTokenError("Credencial de renovación inválida.")
        if credential.consumed_at:
            successor = (
                await self.access.sessions.get_credential(credential.successor_id)
                if credential.successor_id
                else None
            )
            if (
                request_id
                and request_id == credential.request_id
                and successor
                and not successor.consumed_at
                and now - credential.consumed_at <= timedelta(seconds=30)
            ):
                return self.access.tokens.create_session_pair(self.access.grant(session, successor))
            await self.access.sessions.revoke(session.id, now, "refresh_reuse")
            await self.access.accounts.audit(
                "session.refresh_reuse", user.id, None, {"session_id": str(session.id)}, now
            )
            await self.uow.commit()
            raise InvalidTokenError("Se cerró esta sesión por seguridad. Verifica tu teléfono.")
        grant = await self.access.next_grant(session)
        await self.access.sessions.consume_credential(
            credential.id, request_id or uuid4(), grant.credential_id, now
        )
        await self.access.sessions.touch(session.id, now)
        await self.uow.commit()
        return self.access.tokens.create_session_pair(grant)
