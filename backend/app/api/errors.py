"""Mapeo único de excepciones de dominio a respuestas HTTP (DRY)."""

from __future__ import annotations

from fastapi import FastAPI, HTTPException, Request, status
from fastapi.responses import JSONResponse

from app.domain.account_access import (
    AccountAccessDeniedError,
    InvalidAccountProfileError,
    ReauthenticationRequiredError,
)
from app.domain.exceptions import (
    AlreadyRatedError,
    DomainError,
    DriverUnavailableError,
    EmailAlreadyExistsError,
    InvalidCredentialsError,
    InvalidEmailError,
    InvalidFareError,
    InvalidLocationError,
    InvalidRatingError,
    InvalidRideTransitionError,
    InvalidTokenError,
    NotAuthorizedActionError,
    OfferNotFoundError,
    RideAlreadyActiveError,
    RideNotCompletedError,
    RideNotFoundError,
    SavedPlaceNotFoundError,
    UnsupportedProviderError,
    WeakPasswordError,
)
from app.domain.phone_identity import (
    IdentityAlreadyLinkedError,
    InvalidPhoneError,
    PhoneVerificationRateLimitError,
    PhoneVerificationUnavailableError,
)

# Excepción de dominio -> código HTTP.
_STATUS_MAP: dict[type[DomainError], int] = {
    InvalidAccountProfileError: 422,
    ReauthenticationRequiredError: 403,
    AccountAccessDeniedError: 403,
    IdentityAlreadyLinkedError: 409,
    InvalidPhoneError: 422,
    PhoneVerificationRateLimitError: 429,
    PhoneVerificationUnavailableError: 503,
    EmailAlreadyExistsError: status.HTTP_409_CONFLICT,
    InvalidCredentialsError: status.HTTP_401_UNAUTHORIZED,
    InvalidTokenError: status.HTTP_401_UNAUTHORIZED,
    InvalidEmailError: 422,
    WeakPasswordError: 422,
    InvalidLocationError: 422,
    InvalidFareError: 422,
    SavedPlaceNotFoundError: status.HTTP_404_NOT_FOUND,
    RideNotFoundError: status.HTTP_404_NOT_FOUND,
    RideAlreadyActiveError: status.HTTP_409_CONFLICT,
    OfferNotFoundError: status.HTTP_404_NOT_FOUND,
    NotAuthorizedActionError: status.HTTP_403_FORBIDDEN,
    InvalidRideTransitionError: status.HTTP_409_CONFLICT,
    DriverUnavailableError: status.HTTP_409_CONFLICT,
    RideNotCompletedError: status.HTTP_409_CONFLICT,
    AlreadyRatedError: status.HTTP_409_CONFLICT,
    InvalidRatingError: 422,
    UnsupportedProviderError: status.HTTP_400_BAD_REQUEST,
}


def unauthorized(detail: str) -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail=detail,
        headers={"WWW-Authenticate": "Bearer"},
    )


def register_exception_handlers(app: FastAPI) -> None:
    @app.exception_handler(DomainError)
    async def _handle_domain_error(_: Request, exc: DomainError) -> JSONResponse:
        code = _STATUS_MAP.get(type(exc), status.HTTP_400_BAD_REQUEST)
        if isinstance(exc, PhoneVerificationRateLimitError):
            return JSONResponse(status_code=code, content={
                "detail": str(exc), "retry_after_seconds": exc.retry_after_seconds,
            }, headers={"Retry-After": str(exc.retry_after_seconds), "Cache-Control": "no-store"})
        return JSONResponse(status_code=code, content={"detail": str(exc)})
