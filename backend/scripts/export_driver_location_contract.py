"""Export the separate ephemeral GPS contract without negotiation watermarks."""

import argparse
import json
from datetime import UTC, datetime
from pathlib import Path
from uuid import UUID

from app.api.v1.schemas.driver_location import DriverLocationMessage, DriverLocationResponse

SNAPSHOT = Path(__file__).resolve().parents[1] / "driver_location_contract.json"


def serialize_contract() -> str:
    now = datetime(2026, 9, 19, 12, tzinfo=UTC)
    location = DriverLocationResponse(
        ride_id=UUID("00000000-0000-4000-8000-000000000001"),
        driver_id=UUID("00000000-0000-4000-8000-000000000002"),
        latitude=-16.50,
        longitude=-68.13,
        accuracy_meters=8,
        heading=90,
        captured_at=now,
        received_at=now,
    )
    return (
        json.dumps(
            {
                "schema": DriverLocationMessage.model_json_schema(),
                "examples": [
                    DriverLocationMessage(data=None).model_dump(mode="json"),
                    DriverLocationMessage(data=location).model_dump(mode="json"),
                ],
            },
            indent=2,
            ensure_ascii=False,
        )
        + "\n"
    )


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    expected = serialize_contract()
    if args.check:
        if not SNAPSHOT.exists() or SNAPSHOT.read_text() != expected:
            raise SystemExit("Driver location contract differs; regenerate it.")
    else:
        SNAPSHOT.write_text(expected)
