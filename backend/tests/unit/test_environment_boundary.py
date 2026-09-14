"""Check the HTTP environment guard independently of databases and provider I/O."""

from __future__ import annotations

from itertools import permutations

import pytest
from httpx import ASGITransport, AsyncClient
from starlette.applications import Starlette
from starlette.responses import JSONResponse
from starlette.routing import Route

from app.infrastructure.environment_boundary import EnvironmentBoundaryMiddleware

ENVIRONMENTS = ("development", "testing", "production")


def guarded_app(environment):
    async def reached_handler(request):
        return JSONResponse({"reached_handler": True})

    return EnvironmentBoundaryMiddleware(
        Starlette(routes=[Route("/auth/login", reached_handler, methods=["POST"])]),
        environment=environment,
    )


@pytest.mark.parametrize("source,target", list(permutations(ENVIRONMENTS, 2)))
async def test_cross_environment_login_is_rejected_before_reaching_authentication(source, target):
    async with AsyncClient(
        transport=ASGITransport(guarded_app(target)), base_url="http://test"
    ) as client:
        response = await client.post("/auth/login", headers={"X-App-Environment": source})
    assert response.status_code == 400
    assert response.json()["code"] == "environment_mismatch"
    assert response.headers["X-App-Environment"] == target
    assert "reached_handler" not in response.json()


@pytest.mark.parametrize("environment", ENVIRONMENTS)
async def test_matching_and_legacy_requests_keep_working(environment):
    async with AsyncClient(
        transport=ASGITransport(guarded_app(environment)), base_url="http://test"
    ) as client:
        for headers in ({}, {"X-App-Environment": environment}):
            response = await client.post("/auth/login", headers=headers)
            assert response.status_code == 200
            assert response.json() == {"reached_handler": True}
            assert response.headers["X-App-Environment"] == environment


async def test_ambiguous_environment_headers_are_rejected():
    async with AsyncClient(
        transport=ASGITransport(guarded_app("production")), base_url="http://test"
    ) as client:
        response = await client.post(
            "/auth/login",
            headers=[
                ("X-App-Environment", "production"),
                ("X-App-Environment", "testing"),
            ],
        )
    assert response.status_code == 400
