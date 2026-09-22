"""Verify that migration backfills only provable active vehicle identities."""

import uuid

import pytest
from sqlalchemy import bindparam, text
from sqlalchemy.dialects.postgresql import ARRAY
from sqlalchemy.dialects.postgresql import UUID as PgUUID

from tests.postgresql.test_pg_integrity_0017 import _insert_ride, _insert_user


@pytest.mark.parametrize("service", ["taxi", "moto"])
async def test_vehicle_snapshot_backfill_preserves_unknown_history(pg_test_db, service):
    await pg_test_db.purge_accounts()
    await pg_test_db.migrate_async("downgrade", "0028_driver_vehicles")
    expected = {}
    async with pg_test_db.engine.begin() as connection:
        for status in ("accepted", "arriving", "in_progress", "completed", "cancelled"):
            driver_id, rider_id, ride_id, vehicle_id = [uuid.uuid4() for _ in range(4)]
            await _insert_user(connection, driver_id, role="driver")
            await _insert_user(connection, rider_id)
            await connection.execute(
                text(
                    "UPDATE users SET vehicle_type=:service, plate='SNAP-123', "
                    "vehicle_model='Original vehicle' WHERE id=:id"
                ),
                {"service": service, "id": driver_id},
            )
            await connection.execute(
                text(
                    "INSERT INTO driver_vehicles (id, user_id, vehicle_type, plate, vehicle_model) "
                    "VALUES (:id, :user_id, :service, 'SNAP-123', 'Original vehicle')"
                ),
                {"id": vehicle_id, "user_id": driver_id, "service": service},
            )
            await _insert_ride(connection, ride_id, rider_id, status=status, driver_id=driver_id)
            expected[ride_id] = (
                None
                if status in ("completed", "cancelled")
                else {
                    "vehicle_id": str(vehicle_id),
                    "vehicle_type": service,
                    "plate": "SNAP-123",
                    "vehicle_model": "Original vehicle",
                }
            )
    await pg_test_db.migrate_async("upgrade", "head")
    async with pg_test_db.engine.begin() as connection:
        rows = await connection.execute(
            text("SELECT id, vehicle_snapshot FROM ride_requests WHERE id = ANY(:ids)").bindparams(
                bindparam("ids", type_=ARRAY(PgUUID(as_uuid=True)))
            ),
            {"ids": list(expected)},
        )
        assert dict(rows.all()) == expected
    await pg_test_db.purge_accounts()
