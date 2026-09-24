"""HTTP correlation contract and isolation between concurrent requests."""

from __future__ import annotations

import asyncio
import logging
import uuid
from decimal import Decimal

from fastapi import FastAPI, Request
from httpx import ASGITransport, AsyncClient

from app.api.v1 import events
from app.domain.entities import Offer
from app.infrastructure.correlation import (
    REQUEST_ID_HEADER,
    CorrelationIdMiddleware,
    correlation_scope,
    current_correlation_id,
)


def _app() -> FastAPI:
    app = FastAPI()
    app.add_middleware(CorrelationIdMiddleware)

    @app.get("/probe")
    async def probe(request: Request) -> dict[str, str]:
        await asyncio.sleep(0)
        correlation_id = current_correlation_id()
        assert correlation_id is not None
        return {
            "context": str(correlation_id),
            "state": request.state.correlation_id,
        }

    @app.get("/explode")
    async def explode() -> None:
        raise RuntimeError("detalle interno")

    return app


async def test_preserves_valid_request_id_in_context_response_and_log(caplog) -> None:
    expected = uuid.uuid4()
    transport = ASGITransport(app=_app())

    with caplog.at_level(logging.INFO, logger="app.infrastructure.correlation"):
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            response = await client.get(
                "/probe",
                headers={REQUEST_ID_HEADER: str(expected)},
            )

    assert response.status_code == 200
    assert response.headers[REQUEST_ID_HEADER] == str(expected)
    assert response.json() == {"context": str(expected), "state": str(expected)}
    assert f"correlation_id={expected}" in caplog.text
    assert "HTTP /probe outcome=200" in caplog.text


async def test_replaces_invalid_request_id_without_logging_query(caplog) -> None:
    transport = ASGITransport(app=_app())

    with caplog.at_level(logging.INFO, logger="app.infrastructure.correlation"):
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            response = await client.get(
                "/probe?token=must-not-be-logged",
                headers={REQUEST_ID_HEADER: "valor-invalido"},
            )

    generated = uuid.UUID(response.headers[REQUEST_ID_HEADER])
    assert response.json() == {
        "context": str(generated),
        "state": str(generated),
    }
    assert "must-not-be-logged" not in caplog.text
    assert "valor-invalido" not in caplog.text


async def test_replaces_uuid_variant_rejected_by_the_mobile_contract() -> None:
    incompatible = "11111111-1111-1111-1111-111111111111"
    transport = ASGITransport(app=_app())

    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.get(
            "/probe",
            headers={REQUEST_ID_HEADER: incompatible},
        )

    resolved = response.headers[REQUEST_ID_HEADER]
    assert resolved != incompatible
    assert uuid.UUID(resolved).version == 4


async def test_unexpected_500_keeps_request_id_in_response_and_log(caplog) -> None:
    expected = uuid.uuid4()
    transport = ASGITransport(app=_app())

    with caplog.at_level(logging.INFO, logger="app.infrastructure.correlation"):
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            response = await client.get(
                "/explode",
                headers={REQUEST_ID_HEADER: str(expected)},
            )

    assert response.status_code == 500
    assert response.headers[REQUEST_ID_HEADER] == str(expected)
    assert response.text == "Internal Server Error"
    assert f"correlation_id={expected}" in caplog.text
    assert "HTTP /explode outcome=500" in caplog.text
    assert "detalle interno" not in caplog.text


async def test_unresolved_route_never_logs_the_concrete_path(caplog) -> None:
    transport = ASGITransport(app=_app())

    with caplog.at_level(logging.INFO, logger="app.infrastructure.correlation"):
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            response = await client.get("/usuarios/identificador-secreto")

    assert response.status_code == 404
    assert "identificador-secreto" not in caplog.text
    assert "HTTP <unresolved> outcome=404" in caplog.text


async def test_concurrent_requests_keep_independent_contexts() -> None:
    first = uuid.uuid4()
    second = uuid.uuid4()
    transport = ASGITransport(app=_app())

    async with AsyncClient(transport=transport, base_url="http://test") as client:
        first_response, second_response = await asyncio.gather(
            client.get("/probe", headers={REQUEST_ID_HEADER: str(first)}),
            client.get("/probe", headers={REQUEST_ID_HEADER: str(second)}),
        )

    assert first_response.json()["context"] == str(first)
    assert second_response.json()["context"] == str(second)
    assert current_correlation_id() is None


def test_event_batch_inherits_the_current_correlation_id() -> None:
    expected = uuid.uuid4()
    offer = Offer(
        ride_id=uuid.uuid4(),
        driver_id=uuid.uuid4(),
        price=Decimal("25.00"),
    )

    with correlation_scope(expected):
        batch = events.build_expire_offer_events(offer)

    assert {event.correlation_id for event in batch} == {expected}
    assert current_correlation_id() is None
