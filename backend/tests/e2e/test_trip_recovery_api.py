import pytest

from tests.e2e.helpers import sign_in
from tests.e2e.test_offers_flow_api import _complete_ride, _ride_payload


@pytest.mark.parametrize("service_type", ["taxi", "moto"])
async def test_repeated_create_and_edit_after_lost_reply(client, service_type):
    rider = await sign_in(client, "gap-rider")
    payload = _ride_payload(service_type)
    first = await client.post("/api/v1/rides", json=payload, headers=rider.headers)
    assert first.status_code == 201, first.text
    ride_id = first.json()["id"]
    repeated = await client.post("/api/v1/rides", json=payload, headers=rider.headers)
    assert repeated.status_code == 409, repeated.text
    active = await client.get("/api/v1/rides/me/active", headers=rider.headers)
    assert active.json()["id"] == ride_id
    paused = await client.post(f"/api/v1/rides/{ride_id}/pause-edit", headers=rider.headers)
    assert paused.status_code == 200, paused.text
    edited = await client.patch(f"/api/v1/rides/{ride_id}", json=payload, headers=rider.headers)
    assert edited.status_code == 200, edited.text
    assert edited.json()["paused"] is False
    repeated_edit = await client.patch(
        f"/api/v1/rides/{ride_id}", json=payload, headers=rider.headers
    )
    assert repeated_edit.status_code == 409, repeated_edit.text


@pytest.mark.settings(driver_auto_approve=True)
@pytest.mark.parametrize("service_type,other_service", [("taxi", "moto"), ("moto", "taxi")])
async def test_completed_recovery_rating_retry_and_vehicle_history(
    client, service_type, other_service
):
    rider = await sign_in(client, "gap-complete-rider")
    driver = await sign_in(client, "gap-complete-driver")
    for kind in (service_type, other_service):
        vehicle = await client.post(
            "/api/v1/drivers/me/vehicles",
            json={
                "vehicle_type": kind,
                "plate": kind.upper() + "-123",
                "vehicle_model": "Model " + kind,
                "services": [kind],
            },
            headers=driver.headers,
        )
        assert vehicle.status_code == 200, vehicle.text
    switch = await client.post(
        "/api/v1/drivers/me/mode",
        json={
            "mode": "driver",
            "vehicle_type": service_type,
        },
        headers=driver.headers,
    )
    assert switch.status_code == 200, switch.text
    online = await client.post(
        "/api/v1/drivers/me/online", json={"is_online": True}, headers=driver.headers
    )
    assert online.status_code == 200, online.text
    ride_id = await _complete_ride(client, rider.headers, driver.headers, service_type)
    active = await client.get("/api/v1/drivers/me/active-ride", headers=driver.headers)
    pending = await client.get("/api/v1/rides/me/pending-rating", headers=driver.headers)
    assert active.json() is None
    assert pending.json()["id"] == ride_id
    outsider = await sign_in(client, "snapshot-outsider")
    forbidden = await client.get(f"/api/v1/rides/{ride_id}/rating", headers=outsider.headers)
    assert forbidden.status_code == 403
    for participant in (rider, driver):
        absent = await client.get(f"/api/v1/rides/{ride_id}/rating", headers=participant.headers)
        assert absent.status_code == 200
        assert absent.json() is None
        rating = await client.post(
            f"/api/v1/rides/{ride_id}/rating", json={"score": 5}, headers=participant.headers
        )
        repeated = await client.post(
            f"/api/v1/rides/{ride_id}/rating", json={"score": 5}, headers=participant.headers
        )
        assert rating.status_code == 201, rating.text
        assert repeated.status_code == 409, repeated.text
        saved = await client.get(f"/api/v1/rides/{ride_id}/rating", headers=participant.headers)
        assert saved.status_code == 200
        assert saved.json() == rating.json()
    before = await client.get(f"/api/v1/rides/{ride_id}", headers=rider.headers)
    assert before.json()["driver"]["vehicle_type"] == service_type
    offline = await client.post(
        "/api/v1/drivers/me/online", json={"is_online": False}, headers=driver.headers
    )
    assert offline.status_code == 200, offline.text
    switch = await client.post(
        "/api/v1/drivers/me/mode",
        json={
            "mode": "driver",
            "vehicle_type": other_service,
        },
        headers=driver.headers,
    )
    assert switch.status_code == 200, switch.text
    after = await client.get(f"/api/v1/rides/{ride_id}", headers=rider.headers)
    history = await client.get("/api/v1/rides/history", headers=rider.headers)
    assert after.json()["service_type"] == service_type
    assert after.json()["driver"]["vehicle_type"] == service_type
    assert after.json()["driver"]["plate"] == service_type.upper() + "-123"
    assert after.json()["driver"]["vehicle_model"] == "Model " + service_type
    assert history.json()["items"][0]["counterpart"]["vehicle_type"] == service_type
    assert history.json()["items"][0]["counterpart"]["plate"] == service_type.upper() + "-123"
