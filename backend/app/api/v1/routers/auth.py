"""Session endpoints shared by every access flow: refresh and me.

Sign-in lives in ``account_access`` (phone + OTP, social linking). Email and
password access was removed for good; every session is a managed session.
"""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends

from app.api.deps import CurrentUserDep, get_refresh_token
from app.api.errors import unauthorized
from app.api.v1.schemas.auth import RefreshRequest, TokenResponse, UserResponse
from app.application.use_cases.refresh_managed_session import RefreshManagedSession

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/refresh", response_model=TokenResponse)
async def refresh(
    body: RefreshRequest,
    use_case: Annotated[RefreshManagedSession, Depends(get_refresh_token)],
) -> TokenResponse:
    tokens = await use_case.execute(body.refresh_token, body.request_id)
    return TokenResponse(
        access_token=tokens.access_token,
        refresh_token=tokens.refresh_token,
    )


@router.get("/me", response_model=UserResponse)
async def me(current_user: CurrentUserDep) -> UserResponse:
    if current_user is None:  # defensivo; get_current_user ya lanza si falta
        raise unauthorized("No autenticado")
    return UserResponse.from_entity(current_user)
