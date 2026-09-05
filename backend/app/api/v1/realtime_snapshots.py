"""Adaptadores API para snapshots realtime v2 ya capturados por aplicación."""

from __future__ import annotations

from app.api.v1.schemas.offers import OfferResponse
from app.api.v1.schemas.realtime import (
    DriverSnapshotDataV2,
    DriverSnapshotMessageV2,
    RideSnapshotDataV2,
    RideSnapshotMessageV2,
    StreamWatermark,
)
from app.api.v1.schemas.rides import OpenRidePageResponse, OpenRideResponse, RideResponse
from app.application.dto import DriverRealtimeSnapshot, PassengerRealtimeSnapshot


def _watermarks(
    snapshot: PassengerRealtimeSnapshot | DriverRealtimeSnapshot,
) -> list[StreamWatermark]:
    return [
        StreamWatermark(
            stream=checkpoint.stream,
            stream_version=checkpoint.stream_version,
        )
        for checkpoint in snapshot.watermarks
    ]


def build_passenger_snapshot_message_v2(
    snapshot: PassengerRealtimeSnapshot,
) -> RideSnapshotMessageV2:
    """Traduce una captura de aplicación sin realizar nuevas lecturas."""
    return RideSnapshotMessageV2(
        schema_version=2,
        kind="snapshot",
        snapshot_id=snapshot.snapshot_id,
        captured_at=snapshot.captured_at,
        type="ride_snapshot",
        data=RideSnapshotDataV2(
            ride=RideResponse.from_detail(snapshot.ride),
            offers=[OfferResponse.from_detail(offer) for offer in snapshot.offers],
        ),
        watermarks=_watermarks(snapshot),
    )


def build_driver_snapshot_message_v2(
    snapshot: DriverRealtimeSnapshot,
) -> DriverSnapshotMessageV2:
    """Traduce el estado unificado del conductor sin IO ni reglas de negocio."""
    return DriverSnapshotMessageV2(
        schema_version=2,
        kind="snapshot",
        snapshot_id=snapshot.snapshot_id,
        captured_at=snapshot.captured_at,
        type="driver_snapshot",
        data=DriverSnapshotDataV2(
            open_rides=OpenRidePageResponse.from_page(snapshot.open_rides),
            paused_rides=[OpenRideResponse.from_open_ride(ride) for ride in snapshot.paused_rides],
            offers=[OfferResponse.from_detail(offer) for offer in snapshot.offers],
            active_ride=(
                RideResponse.from_detail(snapshot.active_ride)
                if snapshot.active_ride is not None
                else None
            ),
        ),
        watermarks=_watermarks(snapshot),
    )
