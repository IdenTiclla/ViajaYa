"""Translate account access and session management requests into use cases."""

from typing import Annotated, Literal
from uuid import UUID

import phonenumbers
from fastapi import APIRouter, Depends, Header, Response

from app.api.deps import (
    SettingsDep,
    SocialAccountsDep,
    get_change_account_phone,
    get_complete_account_recovery,
    get_complete_phone_sign_in,
    get_manage_account_sessions,
    get_request_account_recovery,
    get_sign_in_with_social,
)
from app.api.errors import unauthorized
from app.api.v1.routers.auth import _auth_response
from app.api.v1.schemas.account_access import (
    AccountSessionResponse,
    AccountSessionsResponse,
    LegacyPhoneLinkRequest,
    LogoutRequest,
    PhoneCapabilitiesResponse,
    PhoneChangeRequest,
    PhoneCompleteRequest,
    PhoneCompleteResponse,
    PhoneCountry,
    RecoveryCaseResponse,
    RecoveryCompleteRequest,
    RecoverySubmitRequest,
    SocialPhoneLinkRequest,
    SocialSignInRequest,
    SocialSignInResponse,
)
from app.api.v1.schemas.auth import AuthResponse
from app.application.use_cases.change_account_phone import ChangeAccountPhone
from app.application.use_cases.complete_account_recovery import CompleteAccountRecovery
from app.application.use_cases.complete_phone_sign_in import CompletePhoneSignIn, PhoneSignInResult
from app.application.use_cases.manage_account_sessions import ManageAccountSessions
from app.application.use_cases.request_account_recovery import RequestAccountRecovery
from app.application.use_cases.sign_in_with_social import SignInWithSocial

router = APIRouter(prefix="/auth", tags=["auth"])
CompleteDep = Annotated[CompletePhoneSignIn, Depends(get_complete_phone_sign_in)]
ManageDep = Annotated[ManageAccountSessions, Depends(get_manage_account_sessions)]


def bearer_token(authorization: Annotated[str | None, Header()] = None) -> str:
    if not authorization or not authorization.lower().startswith("bearer "):
        raise unauthorized("Falta el token de autorización")
    return authorization.split(" ", 1)[1].strip()


BearerDep = Annotated[str, Depends(bearer_token)]


def _completion(result: PhoneSignInResult) -> PhoneCompleteResponse:
    return PhoneCompleteResponse(
        status="authenticated" if result.user else "profile_required",
        auth=_auth_response(result.user, result.tokens) if result.user else None,
    )


@router.get("/phone/capabilities", response_model=PhoneCapabilitiesResponse)
async def capabilities(
    settings: SettingsDep, social: SocialAccountsDep, response: Response,
) -> PhoneCapabilitiesResponse:
    response.headers["Cache-Control"] = "no-store"
    return PhoneCapabilitiesResponse(
        enabled=(
            settings.phone_otp_enabled
            and settings.app_env != "production"
            and settings.otp_mode == "mock"
        ),
        countries=[
            PhoneCountry(
                region=region, calling_code=f"+{phonenumbers.country_code_for_region(region)}"
            )
            for region in settings.phone_otp_allowed_regions
        ],
        terms_version=settings.phone_terms_version,
        terms_text=settings.phone_terms_text,
        social_providers=list(social.verifiers),
    )


@router.post("/phone/complete", response_model=PhoneCompleteResponse)
async def complete_phone(
    body: PhoneCompleteRequest,
    use_case: CompleteDep,
    response: Response,
) -> PhoneCompleteResponse:
    response.headers["Cache-Control"] = "no-store"
    return _completion(await use_case.execute(**body.model_dump()))


@router.post("/phone/link-legacy", response_model=PhoneCompleteResponse)
async def link_legacy(
    body: LegacyPhoneLinkRequest,
    use_case: CompleteDep,
    response: Response,
) -> PhoneCompleteResponse:
    response.headers["Cache-Control"] = "no-store"
    return _completion(
        await use_case.execute(
            **body.model_dump(exclude={"email", "password"}),
            legacy_email=body.email,
            legacy_password=body.password,
        )
    )


@router.post("/phone/link-social", response_model=PhoneCompleteResponse)
async def link_social(
    body: SocialPhoneLinkRequest, use_case: CompleteDep, response: Response,
) -> PhoneCompleteResponse:
    response.headers["Cache-Control"] = "no-store"
    return _completion(await use_case.execute(**body.model_dump()))


@router.post("/social/{provider}/sign-in", response_model=SocialSignInResponse)
async def social_sign_in(
    provider: Literal["google", "facebook"], body: SocialSignInRequest, response: Response,
    use_case: Annotated[SignInWithSocial, Depends(get_sign_in_with_social)],
) -> SocialSignInResponse:
    response.headers["Cache-Control"] = "no-store"
    result = await use_case.execute(provider, **body.model_dump())
    return SocialSignInResponse(
        status="authenticated" if result.user else "phone_required",
        auth=_auth_response(result.user, result.tokens) if result.user else None,
    )


@router.get("/sessions", response_model=AccountSessionsResponse)
async def list_sessions(token: BearerDep, use_case: ManageDep, response: Response):
    response.headers["Cache-Control"] = "no-store"
    sessions, current_id = await use_case.execute(token)
    return AccountSessionsResponse(
        managed=current_id is not None,
        sessions=[
            AccountSessionResponse(
                id=session.id,
                device_name=session.device_name,
                created_at=session.created_at,
                last_seen_at=session.last_seen_at,
                expires_at=session.expires_at,
                current=session.id == current_id,
            )
            for session in sessions
        ],
    )


@router.delete("/sessions/others", status_code=204)
async def revoke_other_sessions(token: BearerDep, use_case: ManageDep) -> None:
    await use_case.execute(token, action="others")


@router.delete("/sessions/{session_id}", status_code=204)
async def revoke_session(session_id: UUID, token: BearerDep, use_case: ManageDep) -> None:
    await use_case.execute(token, action="revoke", session_id=session_id)


@router.post("/logout", status_code=204)
async def logout(body: LogoutRequest, use_case: ManageDep) -> None:
    await use_case.execute(body.refresh_token, action="logout")


@router.post("/phone/change", response_model=AuthResponse)
async def change_phone(
    body: PhoneChangeRequest,
    token: BearerDep,
    response: Response,
    use_case: Annotated[ChangeAccountPhone, Depends(get_change_account_phone)],
) -> AuthResponse:
    response.headers["Cache-Control"] = "no-store"
    user, tokens = await use_case.execute(token, **body.model_dump())
    return _auth_response(user, tokens)


@router.post("/recovery", response_model=RecoveryCaseResponse, status_code=201)
async def request_recovery(
    body: RecoverySubmitRequest,
    response: Response,
    use_case: Annotated[RequestAccountRecovery, Depends(get_request_account_recovery)],
) -> RecoveryCaseResponse:
    response.headers["Cache-Control"] = "no-store"
    result = await use_case.execute(**body.model_dump())
    return RecoveryCaseResponse(case_id=result.id, status=result.status)


@router.post("/recovery/complete", response_model=PhoneCompleteResponse)
async def complete_recovery(
    body: RecoveryCompleteRequest,
    response: Response,
    use_case: Annotated[CompleteAccountRecovery, Depends(get_complete_account_recovery)],
) -> PhoneCompleteResponse:
    response.headers["Cache-Control"] = "no-store"
    return _completion(await use_case.execute(**body.model_dump()))
