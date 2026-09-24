"""Tests of the realtime snapshot consumed by the mobile parsers."""

from __future__ import annotations

import json
from typing import get_args

from app.api.v1.schemas.realtime import (
    NegotiationMessage,
    RealtimeEventType,
)
from scripts.export_realtime_contract import (
    REALTIME_CONTRACT_SNAPSHOT,
    main,
    serialize_realtime_contract,
)


def _production_negotiation_types() -> set[str]:
    union = get_args(NegotiationMessage)[0]
    return {
        modelo.model_fields["type"].default
        for modelo in get_args(union)
    }


def test_realtime_contract_is_deterministic_and_snapshot_is_current() -> None:
    first_serialization = serialize_realtime_contract()
    second_serialization = serialize_realtime_contract()

    assert first_serialization == second_serialization
    assert first_serialization.endswith("\n")
    assert first_serialization == REALTIME_CONTRACT_SNAPSHOT.read_text(
        encoding="utf-8"
    )


def test_realtime_contract_covers_emitted_protocols_and_types() -> None:
    contract = json.loads(serialize_realtime_contract())
    casos = contract["cases"]

    assert contract["fixture_version"] == 1
    assert len({caso["name"] for caso in casos}) == len(casos)
    assert all(
        set(caso["audiences"]) <= {"passenger", "driver"}
        and caso["audiences"]
        for caso in casos
    )

    legacy_types = {
        caso["message"]["type"]
        for caso in casos
        if caso["protocol"] == "legacy"
    }
    v2_event_types = {
        caso["message"]["type"]
        for caso in casos
        if caso["protocol"] == "v2_event"
    }
    v2_snapshot_types = {
        caso["message"]["type"]
        for caso in casos
        if caso["protocol"] == "v2_snapshot"
    }

    assert legacy_types == _production_negotiation_types()
    assert v2_event_types == set(get_args(RealtimeEventType))
    assert v2_snapshot_types == {"ride_snapshot", "driver_snapshot"}


def test_check_detects_drift_without_rewriting(tmp_path, capsys) -> None:
    snapshot = tmp_path / "realtime_contract.json"
    stale_content = '{"contrato":"obsoleto"}\n'
    snapshot.write_text(stale_content, encoding="utf-8")

    assert main(["--check"], destination=snapshot) == 1
    assert snapshot.read_text(encoding="utf-8") == stale_content
    assert "out of date" in capsys.readouterr().err
