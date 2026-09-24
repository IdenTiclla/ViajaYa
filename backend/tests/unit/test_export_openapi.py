"""Pruebas del snapshot OpenAPI versionado."""

from __future__ import annotations

import json

from scripts.export_openapi import OPENAPI_SNAPSHOT, main, serialize_openapi


def test_openapi_is_deterministic_and_the_snapshot_is_current() -> None:
    first_serialization = serialize_openapi()
    second_serialization = serialize_openapi()

    assert first_serialization == second_serialization
    assert first_serialization.endswith("\n")
    assert first_serialization == OPENAPI_SNAPSHOT.read_text(encoding="utf-8")

    schema = json.loads(first_serialization)
    assert schema["info"] == {"title": "ViajaYa API", "version": "0.1.0"}
    assert "/api/v1/rides/open" in schema["paths"]


def test_openapi_marks_nullable_pool_fields_as_required() -> None:
    schema = json.loads(serialize_openapi())
    schemas = schema["components"]["schemas"]

    rider = schemas["OpenRideRiderResponse"]
    assert "rating" in rider["required"]
    assert {variant.get("type") for variant in rider["properties"]["rating"]["anyOf"]} == {
        "number",
        "null",
    }

    page = schemas["OpenRidePageResponse"]
    assert "next_cursor" in page["required"]
    assert {
        variant.get("type")
        for variant in page["properties"]["next_cursor"]["anyOf"]
    } == {"string", "null"}


def test_openapi_marks_nullable_history_and_earnings_as_required() -> None:
    schema = json.loads(serialize_openapi())
    schemas = schema["components"]["schemas"]

    history_item = schemas["RideHistoryItemResponse"]
    assert {"counterpart", "created_at", "my_rating"} <= set(
        history_item["required"]
    )

    counterpart = schemas["HistoryCounterpartSchema"]
    assert {"plate", "rating", "vehicle_model", "vehicle_type"} <= set(
        counterpart["required"]
    )

    history_page = schemas["RideHistoryPageResponse"]
    assert "next_cursor" in history_page["required"]

    earnings_item = schemas["EarningsItemResponse"]
    assert "completed_at" in earnings_item["required"]


def test_check_detects_drift_without_rewriting(tmp_path, capsys) -> None:
    snapshot = tmp_path / "openapi.json"
    stale_content = '{"contrato":"obsoleto"}\n'
    snapshot.write_text(stale_content, encoding="utf-8")

    assert main(["--check"], destination=snapshot) == 1
    assert snapshot.read_text(encoding="utf-8") == stale_content
    assert "out of date" in capsys.readouterr().err
