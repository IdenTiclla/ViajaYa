"""Pickup acknowledgement races against duplicates, departure and cancellation."""

import asyncio

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker

from app.api.deps import get_cancel_ride, get_mark_rider_on_the_way, get_update_ride_status
from app.api.v1.realtime_outbox import OutboxUpdateRideStatusEventRecorder
from app.application.dto import RideDetail
from app.application.use_cases.mark_rider_on_the_way import MarkRiderOnTheWay
from app.domain.entities import RideStatus
from app.domain.exceptions import InvalidRideTransitionError
from app.infrastructure.db.models import RealtimeOutboxModel, RideRequestModel
from app.infrastructure.db.outbox import SqlAlchemyRealtimeOutbox
from app.infrastructure.db.repositories import (
    SqlAlchemyOfferRepository,
    SqlAlchemyUserRepository,
)
from app.infrastructure.db.unit_of_work import SqlAlchemyUnitOfWork
from tests.postgresql.test_pg_update_ride_status import (
    _BarrierRides,
    _insert_scenario,
    _settings,
    _status_use_case,
)


def _notice_use_case(session, barrier):
    return MarkRiderOnTheWay(
        _BarrierRides(session, barrier, commit_update_if_state=False),
        SqlAlchemyOfferRepository(session),
        SqlAlchemyUserRepository(session),
        SqlAlchemyUnitOfWork(session),
        OutboxUpdateRideStatusEventRecorder(SqlAlchemyRealtimeOutbox(session)),
    )


@pytest.mark.parametrize("other", ["notice", "start", "cancel"])
async def test_pickup_notice_is_serialized_with_other_actions(pg_test_db, other):
    sessions = async_sessionmaker(pg_test_db.engine, expire_on_commit=False)
    rider, driver, ride = await _insert_scenario(sessions)
    async with sessions() as session:
        await get_update_ride_status(session, _settings(enabled=False)).execute(
            driver,
            ride.id,
            RideStatus.ARRIVING,
        )
    barrier = asyncio.Barrier(2)
    async with sessions() as first, sessions() as second:
        notice = _notice_use_case(first, barrier).execute(rider, ride.id)
        if other == "notice":
            competing = _notice_use_case(second, barrier).execute(rider, ride.id)
        elif other == "start":
            competing = _status_use_case(
                second,
                _BarrierRides(
                    second,
                    barrier,
                    commit_update_if_state=False,
                ),
            ).execute(driver, ride.id, RideStatus.IN_PROGRESS)
        else:
            competing = get_cancel_ride(
                _BarrierRides(second, barrier),
                SqlAlchemyUserRepository(second),
                second,
                _settings(),
            ).execute(rider, ride.id)
        results = await asyncio.wait_for(
            asyncio.gather(notice, competing, return_exceptions=True), 10
        )
    async with sessions() as session:
        row = await session.get(RideRequestModel, ride.id)
        records = (
            await session.scalars(
                select(RealtimeOutboxModel).where(
                    RealtimeOutboxModel.aggregate_id == ride.id,
                )
            )
        ).all()
        notices = [
            record
            for record in records
            if record.payload["data"].get("status") == "arriving"
            and record.payload["data"].get("rider_on_the_way_at")
        ]
        if other == "notice":
            assert all(isinstance(result, RideDetail) for result in results), results
            assert results[0].ride.rider_on_the_way_at == results[1].ride.rider_on_the_way_at
            assert row.status == RideStatus.ARRIVING
            assert len(notices) == 2
        else:
            assert not isinstance(results[1], BaseException), results
            assert isinstance(results[0], (RideDetail, InvalidRideTransitionError)), results
            assert row.status == (
                RideStatus.IN_PROGRESS if other == "start" else RideStatus.CANCELLED
            )
            assert bool(row.rider_on_the_way_at) == isinstance(results[0], RideDetail)
            assert len(notices) == (2 if row.rider_on_the_way_at else 0)


async def test_outbox_failure_rolls_back_pickup_notice(pg_test_db, monkeypatch):
    sessions = async_sessionmaker(pg_test_db.engine, expire_on_commit=False)
    rider, driver, ride = await _insert_scenario(sessions)
    async with sessions() as session:
        await get_update_ride_status(session, _settings(enabled=False)).execute(
            driver,
            ride.id,
            RideStatus.ARRIVING,
        )

        async def fail_record(*args):
            raise RuntimeError("Outbox unavailable")

        monkeypatch.setattr(OutboxUpdateRideStatusEventRecorder, "record", fail_record)
        with pytest.raises(RuntimeError, match="Outbox unavailable"):
            await get_mark_rider_on_the_way(session, _settings()).execute(rider, ride.id)
    async with sessions() as session:
        row = await session.get(RideRequestModel, ride.id)
        assert row.rider_on_the_way_at is None
        assert row.status == RideStatus.ARRIVING
