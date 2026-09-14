"""Translate phone verification requests without issuing operational credentials."""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, Request, Response

from app.api.deps import ManagedSessionsDep, get_request_phone_code, get_verify_phone_code
from app.api.v1.routers.account_access import BearerDep
from app.api.v1.schemas.phone_verification import (
    PhoneChallengeResponse,
    PhoneChangeCodeRequest,
    PhoneChangeCodeVerifyRequest,
    PhoneCodeRequest,
    PhoneCodeVerifyRequest,
    PhoneVerificationResponse,
    TestPhoneChallengeResponse,
)
from app.application.use_cases.request_phone_code import RequestPhoneCode
from app.application.use_cases.verify_phone_code import VerifyPhoneCode


def create_phone_verification_router(*, include_test_code: bool) -> APIRouter:
    router = APIRouter(prefix="/auth/phone", tags=["auth"])
    challenge_schema = TestPhoneChallengeResponse if include_test_code else PhoneChallengeResponse

    @router.post("/challenges", response_model=challenge_schema,
                 response_model_exclude_none=True, status_code=201)
    async def request_code(
        body: PhoneCodeRequest, request: Request, response: Response,
        use_case: Annotated[RequestPhoneCode, Depends(get_request_phone_code)],
    ) -> PhoneChallengeResponse:
        response.headers["Cache-Control"] = "no-store"
        result = await use_case.execute(
            body.phone, str(body.device_id), request.client.host if request.client else "unknown",
            purpose=body.purpose,
        )
        return challenge_schema.model_validate(result)

    @router.post("/verify", response_model=PhoneVerificationResponse)
    async def verify_code(
        body: PhoneCodeVerifyRequest, request: Request, response: Response,
        use_case: Annotated[VerifyPhoneCode, Depends(get_verify_phone_code)],
    ) -> PhoneVerificationResponse:
        response.headers["Cache-Control"] = "no-store"
        result = await use_case.execute(
            body.challenge_id, body.phone, body.code, str(body.device_id),
            request.client.host if request.client else "unknown",
            purpose=body.purpose,
        )
        return PhoneVerificationResponse.model_validate(result)

    @router.post("/change/challenges", response_model=challenge_schema,
                 response_model_exclude_none=True, status_code=201)
    async def request_change_code(
        body: PhoneChangeCodeRequest, request: Request, response: Response,
        token: BearerDep, access: ManagedSessionsDep,
        use_case: Annotated[RequestPhoneCode, Depends(get_request_phone_code)],
    ) -> PhoneChallengeResponse:
        user, _ = await access.require_recent(token, body.device_id)
        response.headers["Cache-Control"] = "no-store"
        result = await use_case.execute(
            body.phone, str(body.device_id), request.client.host if request.client else "unknown",
            purpose="change_phone", actor_user_id=user.id,
        )
        return challenge_schema.model_validate(result)

    @router.post("/change/verify", response_model=PhoneVerificationResponse)
    async def verify_change_code(
        body: PhoneChangeCodeVerifyRequest, request: Request, response: Response,
        token: BearerDep, access: ManagedSessionsDep,
        use_case: Annotated[VerifyPhoneCode, Depends(get_verify_phone_code)],
    ) -> PhoneVerificationResponse:
        user, _ = await access.require_recent(token, body.device_id)
        response.headers["Cache-Control"] = "no-store"
        result = await use_case.execute(
            body.challenge_id, body.phone, body.code, str(body.device_id),
            request.client.host if request.client else "unknown",
            purpose="change_phone", actor_user_id=user.id,
        )
        return PhoneVerificationResponse.model_validate(result)

    return router
