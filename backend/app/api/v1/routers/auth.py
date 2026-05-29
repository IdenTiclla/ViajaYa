"""Endpoints de autenticación: register, login, refresh, me, oauth/{provider}."""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, status

from app.api.deps import (
    CurrentUserDep,
    get_authenticate_user,
    get_authenticate_with_oauth,
    get_refresh_token,
    get_register_user,
)
from app.api.errors import unauthorized
from app.api.v1.schemas.auth import (
    AuthResponse,
    LoginRequest,
    OAuthRequest,
    RefreshRequest,
    RegisterRequest,
    TokenResponse,
    UserResponse,
)
from app.application.dto import LoginInput, OAuthLoginInput, RegisterInput
from app.application.use_cases.authenticate_user import AuthenticateUser
from app.application.use_cases.authenticate_with_oauth import AuthenticateWithOAuth
from app.application.use_cases.refresh_token import RefreshToken
from app.application.use_cases.register_user import RegisterUser
from app.domain.entities import AuthProvider
from app.domain.exceptions import UnsupportedProviderError

router = APIRouter(prefix="/auth", tags=["auth"])


def _auth_response(user, tokens) -> AuthResponse:
    return AuthResponse(
        user=UserResponse.from_entity(user),
        tokens=TokenResponse(
            access_token=tokens.access_token,
            refresh_token=tokens.refresh_token,
        ),
    )


@router.post("/register", response_model=AuthResponse, status_code=status.HTTP_201_CREATED)
async def register(
    body: RegisterRequest,
    use_case: Annotated[RegisterUser, Depends(get_register_user)],
) -> AuthResponse:
    user, tokens = await use_case.execute(
        RegisterInput(
            full_name=body.full_name,
            email=body.email,
            password=body.password,
            phone=body.phone,
        )
    )
    return _auth_response(user, tokens)


@router.post("/login", response_model=AuthResponse)
async def login(
    body: LoginRequest,
    use_case: Annotated[AuthenticateUser, Depends(get_authenticate_user)],
) -> AuthResponse:
    user, tokens = await use_case.execute(LoginInput(email=body.email, password=body.password))
    return _auth_response(user, tokens)


@router.post("/refresh", response_model=TokenResponse)
async def refresh(
    body: RefreshRequest,
    use_case: Annotated[RefreshToken, Depends(get_refresh_token)],
) -> TokenResponse:
    tokens = await use_case.execute(body.refresh_token)
    return TokenResponse(
        access_token=tokens.access_token,
        refresh_token=tokens.refresh_token,
    )


@router.post("/oauth/{provider}", response_model=AuthResponse)
async def oauth_login(
    provider: str,
    body: OAuthRequest,
    use_case: Annotated[AuthenticateWithOAuth, Depends(get_authenticate_with_oauth)],
) -> AuthResponse:
    try:
        provider_enum = AuthProvider(provider.lower())
    except ValueError as exc:
        raise UnsupportedProviderError(f"Proveedor no soportado: {provider}") from exc
    if provider_enum is AuthProvider.LOCAL:
        raise UnsupportedProviderError("Use /login para autenticación local")

    user, tokens = await use_case.execute(
        OAuthLoginInput(provider=provider_enum, token=body.token)
    )
    return _auth_response(user, tokens)


@router.get("/me", response_model=UserResponse)
async def me(current_user: CurrentUserDep) -> UserResponse:
    if current_user is None:  # defensivo; get_current_user ya lanza si falta
        raise unauthorized("No autenticado")
    return UserResponse.from_entity(current_user)
