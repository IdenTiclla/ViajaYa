"""Exercise deployment boundaries without reaching external providers."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta
from itertools import permutations

import pytest
from jose import jwt
from pydantic import ValidationError

from app.domain.exceptions import InvalidTokenError
from app.infrastructure.config import Settings
from app.infrastructure.security.jwt_service import JwtTokenService

ENVIRONMENTS = ("development", "testing", "production")
TEST_SECRET = "a9f456f7cd884b8eb21267afe162b22bf11c067d9c814b67aaca2704b6767a24"


def environment_values(app_env: str) -> dict:
    """Use synthetic hosts and credentials, never the developer's .env file."""
    values = {"app_env": app_env, "jwt_secret": TEST_SECRET}
    if app_env != "development":
        values.update(
            public_api_url=f"https://api-{app_env}.example.test/api/v1",
            database_url=(
                "postgresql+asyncpg://fixture:fixture-database-key@database.internal/"
                f"viajaya_{app_env}"
            ),
            cors_origins=f"https://admin-{app_env}.example.test",
            realtime_redis_url=f"rediss://cache-{app_env}.internal:6379/0",
            realtime_redis_channel=f"viajaya:{app_env}:realtime:v2",
            realtime_presence_key_prefix=f"viajaya:{app_env}:presence:v1",
            payment_mode="live" if app_env == "production" else "sandbox",
        )
    if app_env == "production":
        values.update(
            otp_mode="provider", otp_test_autofill=False, email_mode="live", push_mode="live"
        )
    return values


@pytest.mark.parametrize("app_env", ENVIRONMENTS)
def test_environment_resolves_isolated_identities(app_env):
    settings = Settings(_env_file=None, **environment_values(app_env))
    assert settings.jwt_issuer == f"viajaya:{app_env}"
    assert settings.jwt_audience == f"viajaya:mobile:{app_env}"
    assert settings.storage_namespace == f"viajaya-{app_env}"


@pytest.mark.parametrize("app_env", ["staging", "test", "prod", "", "Production"])
def test_unknown_environment_is_rejected(app_env):
    with pytest.raises(ValidationError):
        Settings(_env_file=None, app_env=app_env)


@pytest.mark.parametrize(
    "field,value",
    [
        ("public_api_url", "http://api.example.test/api/v1"),
        ("public_api_url", "https://localhost/api/v1"),
        ("public_api_url", "https://localhost./api/v1"),
        ("public_api_url", "https://2130706433/api/v1"),
        ("public_api_url", "https://127.0.0.1/api/v1"),
        ("public_api_url", "https://[::1]/api/v1"),
        ("public_api_url", "https://api.example.test/api/v1?token=secret"),
        ("public_api_url", "https://user:secret@api.example.test/api/v1"),
        ("public_api_url", "https://api.example.test/wrong-path"),
        ("database_url", "postgresql+asyncpg://fixture:secret@database.internal/viajaya_testing"),
        ("database_url", "postgresql+asyncpg://fixture:secret@localhost/viajaya_production"),
        (
            "database_url",
            "postgresql+asyncpg://viajaya:viajaya@database.internal/viajaya_production",
        ),
        ("database_url", "sqlite+aiosqlite:///:memory:"),
        (
            "database_url",
            "postgresql+asyncpg://fixture:replace-me@database.internal/viajaya_production",
        ),
        ("jwt_secret", "short"),
        ("jwt_secret", "change-me-in-production-use-a-long-random-string"),
        ("jwt_issuer", "viajaya:testing"),
        ("jwt_audience", "viajaya:mobile:development"),
        ("jwt_algorithm", "none"),
        ("cors_origins", "*"),
        ("cors_origins", "https://localhost"),
        ("cors_origins", "https://admin.example.test/path"),
        ("realtime_redis_url", "redis://localhost:6379/0"),
        ("realtime_redis_channel", "viajaya:testing:realtime:v2"),
        ("realtime_presence_key_prefix", "viajaya:testing:presence:v1"),
        ("storage_namespace", "viajaya-testing"),
        ("otp_mode", "mock"),
        ("otp_test_autofill", True),
        ("payment_mode", "sandbox"),
        ("email_mode", "mock"),
        ("push_mode", "restricted"),
        ("notification_test_recipients", "tester@example.test"),
    ],
)
def test_production_rejects_unsafe_or_cross_environment_configuration(field, value):
    values = environment_values("production") | {field: value}
    with pytest.raises(ValidationError):
        Settings(_env_file=None, **values)


@pytest.mark.parametrize("app_env", ["development", "testing"])
@pytest.mark.parametrize(
    "override",
    [
        {"otp_mode": "provider"},
        {"otp_provider_api_key": "must-not-be-used"},
        {"email_mode": "live"},
        {"push_mode": "live"},
        {"push_mode": "restricted"},
        {"payment_mode": "live"},
    ],
)
def test_lower_environments_reject_real_otp_and_unrestricted_providers(app_env, override):
    with pytest.raises(ValidationError):
        Settings(_env_file=None, **(environment_values(app_env) | override))


@pytest.mark.parametrize("app_env", ["development", "testing"])
def test_lower_otp_autofill_can_be_disabled_without_enabling_a_provider(app_env):
    settings = Settings(
        _env_file=None, **(environment_values(app_env) | {"otp_test_autofill": False})
    )
    assert settings.otp_mode == "mock"
    assert settings.otp_provider_api_key is None
    assert settings.otp_test_autofill is False


def test_restricted_notifications_require_a_test_recipient_list():
    settings = Settings(
        _env_file=None, push_mode="restricted", notification_test_recipients="tester"
    )
    assert settings.push_mode == "restricted"


def test_validation_errors_do_not_print_credentials():
    secret = "sensitive-value-must-not-appear"
    with pytest.raises(ValidationError) as error:
        Settings(_env_file=None, **(environment_values("production") | {"jwt_secret": secret}))
    assert secret not in str(error.value)


@pytest.mark.parametrize("app_env", ENVIRONMENTS)
@pytest.mark.parametrize("kind", ["access", "refresh"])
def test_issued_tokens_round_trip_in_their_environment(app_env, kind):
    service = JwtTokenService(Settings(_env_file=None, **environment_values(app_env)))
    user_id = uuid.uuid4()
    token = getattr(service, f"create_{kind}_token")(user_id)
    assert getattr(service, f"decode_{kind}_token")(token) == user_id


@pytest.mark.parametrize("source,target", list(permutations(ENVIRONMENTS, 2)))
@pytest.mark.parametrize("kind", ["access", "refresh"])
def test_tokens_are_rejected_across_environments_even_with_the_same_key(source, target, kind):
    source_service = JwtTokenService(Settings(_env_file=None, **environment_values(source)))
    target_service = JwtTokenService(Settings(_env_file=None, **environment_values(target)))
    token = getattr(source_service, f"create_{kind}_token")(uuid.uuid4())
    with pytest.raises(InvalidTokenError):
        getattr(target_service, f"decode_{kind}_token")(token)


@pytest.mark.parametrize("claim", ["iss", "aud", "exp", "iat", "sub"])
def test_legacy_or_incomplete_tokens_cannot_bypass_environment_checks(claim):
    settings = Settings(_env_file=None, **environment_values("development"))
    now = datetime.now(UTC)
    payload = {
        "sub": str(uuid.uuid4()),
        "type": "access",
        "iss": settings.jwt_issuer,
        "aud": settings.jwt_audience,
        "iat": now,
        "exp": now + timedelta(minutes=5),
    }
    del payload[claim]
    token = jwt.encode(payload, settings.jwt_secret, algorithm=settings.jwt_algorithm)
    with pytest.raises(InvalidTokenError):
        JwtTokenService(settings).decode_access_token(token)


def test_access_and_refresh_tokens_are_not_interchangeable():
    service = JwtTokenService(Settings(_env_file=None))
    user_id = uuid.uuid4()
    with pytest.raises(InvalidTokenError):
        service.decode_access_token(service.create_refresh_token(user_id))
    with pytest.raises(InvalidTokenError):
        service.decode_refresh_token(service.create_access_token(user_id))
