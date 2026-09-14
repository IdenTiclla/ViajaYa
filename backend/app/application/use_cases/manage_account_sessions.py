"""List sessions or revoke owned sessions without exposing another account."""

from datetime import UTC, datetime
from uuid import UUID

from app.application.account_access import ManagedSession
from app.application.interfaces import UnitOfWork
from app.application.managed_sessions import ManagedSessions
from app.domain.exceptions import InvalidTokenError


class ManageAccountSessions:
    def __init__(self, access: ManagedSessions, uow: UnitOfWork) -> None:
        self.access, self.uow = access, uow

    async def execute(
        self,
        token: str,
        *,
        action: str = "list",
        session_id: UUID | None = None,
    ) -> tuple[list[ManagedSession], UUID | None]:
        if action == "logout":
            claims = self.access.tokens.decode_refresh_claims(token)
            await self.access.accounts.lock_user(claims.user_id)
        else:
            _, claims = await self.access.authenticate(token)
            await self.access.accounts.lock_user(claims.user_id)
            await self.access.authenticate(token)
        now = datetime.now(UTC)
        if action == "list":
            return await self.access.sessions.list_for_user(claims.user_id), claims.session_id
        if action == "others":
            if not claims.session_id:
                raise InvalidTokenError("Verifica tu teléfono antes de gestionar tus sesiones.")
            await self.access.sessions.revoke_for_user(
                claims.user_id, now, "user_revoked", except_session_id=claims.session_id
            )
        else:
            target = claims.session_id if action == "logout" else session_id
            session = await self.access.sessions.get(target, lock=True) if target else None
            if session and session.user_id == claims.user_id:
                await self.access.sessions.revoke(session.id, now, action)
        await self.access.accounts.audit(
            "session.revoked", claims.user_id, claims.user_id, {"action": action}, now
        )
        await self.uow.commit()
        return [], claims.session_id
