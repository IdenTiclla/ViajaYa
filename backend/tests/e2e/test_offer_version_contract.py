"""Offer version validation must not destroy a driver's valid negotiation."""

import uuid

import pytest
from sqlalchemy import select

from app.domain.entities import VehicleType
from app.infrastructure.db.models import OfferModel, RealtimeOutboxModel
from tests.e2e.helpers import promote_to_driver, sign_in
from tests.e2e.test_offers_flow_api import _ride_payload


@pytest.mark.settings(
    realtime_outbox_recording_enabled=True, realtime_outbox_dispatch_mode="shadow"
)
@pytest.mark.parametrize("service", ["taxi", "moto"])
@pytest.mark.parametrize("accept_at_fare", [True, False])
async def test_invalid_version_preserves_existing_offer_and_emits_no_replacement(
    client, session_factory, service, accept_at_fare,
):
    rider = await sign_in(client, "version-rider")
    driver = await sign_in(client, "version-driver")
    await promote_to_driver(session_factory, "version-driver", VehicleType(service))
    created = await client.post("/api/v1/rides", json=_ride_payload(service), headers=rider.headers)
    assert created.status_code == 201, created.text
    ride_id = created.json()["id"]
    path = f"/api/v1/rides/{ride_id}/offers"
    original = await client.post(
        path, json={"accept_at_fare": True, "eta_min": 5}, headers=driver.headers,
    )
    assert original.status_code == 201, original.text

    async def stored_state():
        async with session_factory() as session:
            offers = (await session.execute(
                select(OfferModel.id, OfferModel.status, OfferModel.eta_min, OfferModel.price)
                .where(OfferModel.ride_id == uuid.UUID(ride_id))
                .order_by(OfferModel.id)
            )).all()
            events = (await session.scalars(
                select(RealtimeOutboxModel.id)
                .where(RealtimeOutboxModel.aggregate_id == uuid.UUID(ride_id))
                .order_by(RealtimeOutboxModel.id)
            )).all()
            return offers, events

    before = await stored_state()
    assert len(before[0]) == 1
    assert before[1]
    for invalid, expected_status in [(0, 422), (-1, 422), (1.5, 422), ("invalid", 422), (999, 409)]:
        response = await client.post(
            path, headers=driver.headers,
            json={
                "accept_at_fare": accept_at_fare, "price": "23.00", "eta_min": 9,
                "expected_pool_version": invalid,
            },
        )
        assert response.status_code == expected_status, response.text
        assert await stored_state() == before
        assert (await client.get(path, headers=rider.headers)).json() == [original.json()]

    # Omitted and explicit null versions remain compatible with existing clients.
    legacy = await client.post(
        path, headers=driver.headers,
        json={"accept_at_fare": accept_at_fare, "price": "23.00", "eta_min": 7,
              "expected_pool_version": None},
    )
    assert legacy.status_code == 201, legacy.text
    assert legacy.json()["id"] != original.json()["id"]
    assert (await client.get(path, headers=rider.headers)).json() == [legacy.json()]
