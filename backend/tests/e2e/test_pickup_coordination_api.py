"""Taxi/motorcycle pickup acknowledgements, authorization and durable delivery."""

import uuid

import pytest
from sqlalchemy import select

from app.api.v1.schemas.rides import RideResponse
from app.domain.entities import VehicleType, services_for_vehicle
from app.infrastructure.db.models import RealtimeOutboxModel
from app.infrastructure.db.realtime_snapshots import SqlAlchemyRealtimeSnapshotReader
from tests.e2e.helpers import promote_to_driver, sign_in
from tests.e2e.test_offers_flow_api import _ride_payload


@pytest.mark.settings(
    realtime_outbox_recording_enabled=True, realtime_outbox_dispatch_mode="shadow"
)
@pytest.mark.parametrize("service", ["taxi", "moto"])
async def test_pickup_notice_is_authorized_durable_and_idempotent(client, session_factory, service):
    rider = await sign_in(client, "pickup-rider")
    driver = await sign_in(client, "pickup-driver")
    outsider = await sign_in(client, "pickup-outsider")
    await promote_to_driver(session_factory, "pickup-driver", VehicleType(service))
    created = await client.post("/api/v1/rides", json=_ride_payload(service), headers=rider.headers)
    assert created.status_code == 201, created.text
    ride_id = created.json()["id"]
    path = f"/api/v1/rides/{ride_id}"
    notice_path = f"{path}/rider-on-the-way"
    assert (await client.post(notice_path, headers=rider.headers)).status_code == 409
    assert (await client.post(notice_path, headers=outsider.headers)).status_code == 403
    offer = await client.post(
        f"{path}/offers",
        json={"accept_at_fare": False, "price": "28.00", "eta_min": 5},
        headers=driver.headers,
    )
    assert offer.status_code == 201, offer.text
    accepted = await client.post(
        f"/api/v1/rides/offers/{offer.json()['id']}/accept", headers=rider.headers
    )
    assert accepted.status_code == 200, accepted.text
    assert accepted.json()["accepted_price"] == "28.00"
    assert (await client.post(notice_path, headers=rider.headers)).status_code == 409
    arrived = await client.patch(
        f"{path}/status", json={"status": "arriving"}, headers=driver.headers
    )
    assert arrived.status_code == 200
    assert arrived.json()["rider_on_the_way_at"] is None
    assert (await client.post(notice_path, headers=driver.headers)).status_code == 403
    notice = await client.post(notice_path, headers=rider.headers)
    assert notice.status_code == 200, notice.text
    payload = notice.json()
    assert payload["status"] == "arriving"
    assert payload["rider_on_the_way_at"] is not None
    repeated = await client.post(notice_path, headers=rider.headers)
    assert repeated.json() == payload
    for user in (rider, driver):
        assert (await client.get(path, headers=user.headers)).json() == payload
    assert (
        await client.get("/api/v1/drivers/me/active-ride", headers=driver.headers)
    ).json() == payload
    snapshots = SqlAlchemyRealtimeSnapshotReader(session_factory)
    passenger_snapshot = await snapshots.read_passenger(uuid.UUID(ride_id), [f"ride:{ride_id}"])
    driver_snapshot = await snapshots.read_driver(
        uuid.UUID(driver.user_id),
        [*(f"pool:{item.value}" for item in services_for_vehicle(VehicleType(service))),
         f"driver:{driver.user_id}"],
    )
    for detail in (passenger_snapshot.ride, driver_snapshot.active_ride):
        assert RideResponse.from_detail(detail).model_dump(mode="json") == payload
    async with session_factory() as session:
        records = (
            await session.scalars(
                select(RealtimeOutboxModel).where(
                    RealtimeOutboxModel.aggregate_id == uuid.UUID(ride_id),
                    RealtimeOutboxModel.event_type == "ride_status",
                )
            )
        ).all()
        notices = [row for row in records if row.payload["data"].get("rider_on_the_way_at")]
        assert len(notices) == 2  # One durable delivery per participant; retries add none.
        assert all(row.payload == {"type": "ride_status", "data": payload} for row in notices)
        assert {row.topic for row in notices} == {f"ride:{ride_id}", f"driver:{driver.user_id}"}
    for status in ("in_progress", "completed"):
        response = await client.patch(
            f"{path}/status", json={"status": status}, headers=driver.headers
        )
        assert response.status_code == 200, response.text
        assert response.json()["rider_on_the_way_at"] == payload["rider_on_the_way_at"]
    assert (await client.post(notice_path, headers=rider.headers)).json()["status"] == "completed"
    rating = await client.post(
        f"{path}/rating", json={"score": 5, "comment": "Buen viaje"}, headers=rider.headers
    )
    assert rating.status_code == 201, rating.text
    assert (
        await client.get("/api/v1/rides/me/pending-rating", headers=rider.headers)
    ).json() is None
    history = (await client.get("/api/v1/rides/history", headers=rider.headers)).json()["items"][0]
    assert history["my_rating"] == 5
    assert history["price"] == "28.00"


@pytest.mark.parametrize("terminal", ["in_progress", "cancelled"])
async def test_first_pickup_notice_cannot_modify_a_departed_or_cancelled_ride(
    client, session_factory, terminal
):
    rider = await sign_in(client, "late-rider")
    driver = await sign_in(client, "late-driver")
    await promote_to_driver(session_factory, "late-driver", VehicleType.TAXI)
    ride = (await client.post("/api/v1/rides", json=_ride_payload(), headers=rider.headers)).json()
    path = f"/api/v1/rides/{ride['id']}"
    offer = (
        await client.post(f"{path}/offers", json={"accept_at_fare": True}, headers=driver.headers)
    ).json()
    await client.post(f"/api/v1/rides/offers/{offer['id']}/accept", headers=rider.headers)
    await client.patch(f"{path}/status", json={"status": "arriving"}, headers=driver.headers)
    if terminal == "cancelled":
        await client.post(f"{path}/cancel", headers=rider.headers)
    else:
        await client.patch(f"{path}/status", json={"status": terminal}, headers=driver.headers)
    assert (await client.post(f"{path}/rider-on-the-way", headers=rider.headers)).status_code == 409
    saved = (await client.get(path, headers=rider.headers)).json()
    assert saved["status"] == terminal
    assert saved["rider_on_the_way_at"] is None
