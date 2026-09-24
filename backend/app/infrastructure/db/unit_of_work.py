"""SQLAlchemy unit of work over an already injected session."""

from __future__ import annotations

from sqlalchemy.ext.asyncio import AsyncSession

from app.application.interfaces import UnitOfWork


class SqlAlchemyUnitOfWork(UnitOfWork):
    """Delegate the transactional boundary to the repositories' same session.

    It does not open a nested transaction: an earlier authentication read may
    already have started SQLAlchemy's ``autobegin`` in the current request.
    """

    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def commit(self) -> None:
        await self._session.commit()

    async def rollback(self) -> None:
        await self._session.rollback()
