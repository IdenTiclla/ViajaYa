"""Caso de uso: registrar un usuario con email y contraseña."""

from __future__ import annotations

from app.application.dto import RegisterInput, TokenPair
from app.application.interfaces import PasswordHasher, TokenService
from app.application.token_issuer import issue_token_pair
from app.domain.entities import AuthProvider, User
from app.domain.exceptions import EmailAlreadyExistsError
from app.domain.repositories import UserRepository
from app.domain.value_objects import Email, RawPassword


class RegisterUser:
    def __init__(
        self,
        users: UserRepository,
        hasher: PasswordHasher,
        tokens: TokenService,
    ) -> None:
        self._users = users
        self._hasher = hasher
        self._tokens = tokens

    async def execute(self, data: RegisterInput) -> tuple[User, TokenPair]:
        email = Email(data.email)
        RawPassword(data.password)  # valida la política de contraseña

        if await self._users.get_by_email(email.value):
            raise EmailAlreadyExistsError("Ya existe una cuenta con ese correo.")

        user = User(
            full_name=data.full_name.strip(),
            email=email.value,
            phone=data.phone,
            hashed_password=self._hasher.hash(data.password),
            auth_provider=AuthProvider.LOCAL,
        )
        created = await self._users.add(user)
        return created, issue_token_pair(self._tokens, created.id)
