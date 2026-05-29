"""Tests unitarios de los casos de uso con dobles en memoria."""

from __future__ import annotations

import pytest

from app.application.dto import LoginInput, OAuthLoginInput, RegisterInput
from app.application.use_cases.authenticate_user import AuthenticateUser
from app.application.use_cases.authenticate_with_oauth import AuthenticateWithOAuth
from app.application.use_cases.refresh_token import RefreshToken
from app.application.use_cases.register_user import RegisterUser
from app.domain.entities import AuthProvider
from app.domain.exceptions import (
    EmailAlreadyExistsError,
    InvalidCredentialsError,
    UnsupportedProviderError,
    WeakPasswordError,
)
from tests.fakes import (
    FakePasswordHasher,
    FakeTokenService,
    FakeVerifier,
    InMemoryUserRepository,
)


@pytest.fixture
def deps():
    return InMemoryUserRepository(), FakePasswordHasher(), FakeTokenService()


async def test_register_creates_user_and_tokens(deps):
    repo, hasher, tokens = deps
    use_case = RegisterUser(repo, hasher, tokens)

    user, pair = await use_case.execute(
        RegisterInput(full_name="Alex Walker", email="Alex@Example.com", password="secret123")
    )

    assert user.email == "alex@example.com"  # normalizado
    assert user.auth_provider is AuthProvider.LOCAL
    assert user.hashed_password == "hashed::secret123"
    assert pair.access_token == f"access::{user.id}"


async def test_register_duplicate_email_raises(deps):
    repo, hasher, tokens = deps
    use_case = RegisterUser(repo, hasher, tokens)
    payload = RegisterInput(full_name="A", email="dup@example.com", password="secret123")
    await use_case.execute(payload)

    with pytest.raises(EmailAlreadyExistsError):
        await use_case.execute(payload)


async def test_register_weak_password_raises(deps):
    repo, hasher, tokens = deps
    use_case = RegisterUser(repo, hasher, tokens)
    with pytest.raises(WeakPasswordError):
        await use_case.execute(
            RegisterInput(full_name="A", email="weak@example.com", password="123")
        )


async def test_authenticate_success(deps):
    repo, hasher, tokens = deps
    await RegisterUser(repo, hasher, tokens).execute(
        RegisterInput(full_name="A", email="login@example.com", password="secret123")
    )

    user, pair = await AuthenticateUser(repo, hasher, tokens).execute(
        LoginInput(email="login@example.com", password="secret123")
    )
    assert pair.refresh_token == f"refresh::{user.id}"


async def test_authenticate_wrong_password_raises(deps):
    repo, hasher, tokens = deps
    await RegisterUser(repo, hasher, tokens).execute(
        RegisterInput(full_name="A", email="login@example.com", password="secret123")
    )
    with pytest.raises(InvalidCredentialsError):
        await AuthenticateUser(repo, hasher, tokens).execute(
            LoginInput(email="login@example.com", password="wrongpass")
        )


async def test_authenticate_unknown_email_raises(deps):
    repo, hasher, tokens = deps
    with pytest.raises(InvalidCredentialsError):
        await AuthenticateUser(repo, hasher, tokens).execute(
            LoginInput(email="ghost@example.com", password="secret123")
        )


async def test_refresh_returns_new_pair(deps):
    repo, hasher, tokens = deps
    user, pair = await RegisterUser(repo, hasher, tokens).execute(
        RegisterInput(full_name="A", email="r@example.com", password="secret123")
    )
    new_pair = await RefreshToken(tokens).execute(pair.refresh_token)
    assert new_pair.access_token == f"access::{user.id}"


async def test_oauth_creates_user_then_reuses(deps):
    repo, _, tokens = deps
    verifiers = {AuthProvider.GOOGLE.value: FakeVerifier(AuthProvider.GOOGLE)}
    use_case = AuthenticateWithOAuth(repo, tokens, verifiers)

    user1, _ = await use_case.execute(
        OAuthLoginInput(provider=AuthProvider.GOOGLE, token="g-123")
    )
    assert user1.auth_provider is AuthProvider.GOOGLE
    assert user1.provider_id == "g-123"

    user2, _ = await use_case.execute(
        OAuthLoginInput(provider=AuthProvider.GOOGLE, token="g-123")
    )
    assert user2.id == user1.id  # find-or-create reutiliza
    assert len(repo.users) == 1


async def test_oauth_unsupported_provider_raises(deps):
    repo, _, tokens = deps
    use_case = AuthenticateWithOAuth(repo, tokens, {})
    with pytest.raises(UnsupportedProviderError):
        await use_case.execute(
            OAuthLoginInput(provider=AuthProvider.FACEBOOK, token="x")
        )
