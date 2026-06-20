"""Caso de uso: el conductor alterna su disponibilidad (en línea/desconectado)."""

from __future__ import annotations

from app.domain.entities import User
from app.domain.exceptions import NotAuthorizedActionError
from app.domain.repositories import UserRepository


class SetDriverOnline:
    def __init__(self, users: UserRepository) -> None:
        self._users = users

    async def execute(self, driver: User, is_online: bool) -> User:
        if not driver.is_driver:
            raise NotAuthorizedActionError(
                "Solo los conductores pueden cambiar su disponibilidad."
            )
        driver.is_online = is_online
        return await self._users.update(driver)
