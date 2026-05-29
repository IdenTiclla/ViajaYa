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
from app.application.use_cases.authenticate_user import AuthenticateUser
from app.application.use_cases.authenticate_with_oauth import AuthenticateWithOAuth
from app.application.use_cases.refresh_token import RefreshToken
from app.application.use_cases.register_user import RegisterUser
from app.domain.entities import AuthProvider, User
from app.domain.exceptions import InvalidTokenError
from app.domain.repositories import UserRepository
from app.infrastructure.config import Settings, get_settings
from app.infrastructure.db.repositories import SqlAlchemyUserRepository
from app.infrastructure.db.session import get_session
from app.infrastructure.oauth.facebook_verifier import FacebookIdentityVerifier
from app.infrastructure.oauth.google_verifier import GoogleIdentityVerifier
from app.infrastructure.security.bcrypt_hasher import BcryptPasswordHasher
from app.infrastructure.security.jwt_service import JwtTokenService

SettingsDep = Annotated[Settings, Depends(get_settings)]
SessionDep = Annotated[AsyncSession, Depends(get_session)]


def get_user_repository(session: SessionDep) -> UserRepository:
    return SqlAlchemyUserRepository(session)


UserRepositoryDep = Annotated[UserRepository, Depends(get_user_repository)]


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
