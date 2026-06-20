"""Mapeo único de excepciones de dominio a respuestas HTTP (DRY)."""

from __future__ import annotations

from fastapi import FastAPI, HTTPException, Request, status
from fastapi.responses import JSONResponse

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
    RideNotCompletedError,
    RideNotFoundError,
    SavedPlaceNotFoundError,
    UnsupportedProviderError,
    WeakPasswordError,
)

# Excepción de dominio -> código HTTP.
_STATUS_MAP: dict[type[DomainError], int] = {
    EmailAlreadyExistsError: status.HTTP_409_CONFLICT,
    InvalidCredentialsError: status.HTTP_401_UNAUTHORIZED,
    InvalidTokenError: status.HTTP_401_UNAUTHORIZED,
    InvalidEmailError: 422,
    WeakPasswordError: 422,
    InvalidLocationError: 422,
    InvalidFareError: 422,
    SavedPlaceNotFoundError: status.HTTP_404_NOT_FOUND,
    RideNotFoundError: status.HTTP_404_NOT_FOUND,
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
        return JSONResponse(status_code=code, content={"detail": str(exc)})
