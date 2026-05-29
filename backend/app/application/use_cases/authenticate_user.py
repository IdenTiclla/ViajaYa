"""Caso de uso: autenticar con email y contraseña."""

from __future__ import annotations

from app.application.dto import LoginInput, TokenPair
from app.application.interfaces import PasswordHasher, TokenService
from app.application.token_issuer import issue_token_pair
from app.domain.entities import User
from app.domain.exceptions import InvalidCredentialsError
from app.domain.repositories import UserRepository


class AuthenticateUser:
    def __init__(
        self,
        users: UserRepository,
        hasher: PasswordHasher,
        tokens: TokenService,
    ) -> None:
        self._users = users
        self._hasher = hasher
        self._tokens = tokens

    async def execute(self, data: LoginInput) -> tuple[User, TokenPair]:
        user = await self._users.get_by_email(data.email.strip().lower())
        # Mensaje genérico para no revelar si el correo existe.
        if user is None or user.hashed_password is None:
            raise InvalidCredentialsError("Correo o contraseña incorrectos.")
        if not self._hasher.verify(data.password, user.hashed_password):
            raise InvalidCredentialsError("Correo o contraseña incorrectos.")
        return user, issue_token_pair(self._tokens, user.id)
