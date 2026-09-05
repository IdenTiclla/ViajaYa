"""Unidad de trabajo SQLAlchemy sobre una sesión ya inyectada."""

from __future__ import annotations

from sqlalchemy.ext.asyncio import AsyncSession

from app.application.interfaces import UnitOfWork


class SqlAlchemyUnitOfWork(UnitOfWork):
    """Delega la frontera transaccional en la misma sesión de los repositorios.

    No abre una transacción anidada: una lectura previa de autenticación puede
    haber iniciado ya el ``autobegin`` de SQLAlchemy en el request actual.
    """

    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def commit(self) -> None:
        await self._session.commit()

    async def rollback(self) -> None:
        await self._session.rollback()
