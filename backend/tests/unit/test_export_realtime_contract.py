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
    serializar_contrato_realtime,
)


def _tipos_negociacion_productivos() -> set[str]:
    union = get_args(NegotiationMessage)[0]
    return {
        modelo.model_fields["type"].default
        for modelo in get_args(union)
    }


def test_contrato_realtime_es_determinista_y_snapshot_esta_actualizado() -> None:
    primera_serializacion = serializar_contrato_realtime()
    segunda_serializacion = serializar_contrato_realtime()

    assert primera_serializacion == segunda_serializacion
    assert primera_serializacion.endswith("\n")
    assert primera_serializacion == REALTIME_CONTRACT_SNAPSHOT.read_text(
        encoding="utf-8"
    )


def test_contrato_realtime_cubre_protocolos_y_tipos_emitidos() -> None:
    contrato = json.loads(serializar_contrato_realtime())
    casos = contrato["cases"]

    assert contrato["fixture_version"] == 1
    assert len({caso["name"] for caso in casos}) == len(casos)
    assert all(
        set(caso["audiences"]) <= {"passenger", "driver"}
        and caso["audiences"]
        for caso in casos
    )

    tipos_legacy = {
        caso["message"]["type"]
        for caso in casos
        if caso["protocol"] == "legacy"
    }
    tipos_eventos_v2 = {
        caso["message"]["type"]
        for caso in casos
        if caso["protocol"] == "v2_event"
    }
    tipos_snapshots_v2 = {
        caso["message"]["type"]
        for caso in casos
        if caso["protocol"] == "v2_snapshot"
    }

    assert tipos_legacy == _tipos_negociacion_productivos()
    assert tipos_eventos_v2 == set(get_args(RealtimeEventType))
    assert tipos_snapshots_v2 == {"ride_snapshot", "driver_snapshot"}


def test_check_detecta_drift_sin_reescribir(tmp_path, capsys) -> None:
    snapshot = tmp_path / "realtime_contract.json"
    contenido_obsoleto = '{"contrato":"obsoleto"}\n'
    snapshot.write_text(contenido_obsoleto, encoding="utf-8")

    assert main(["--check"], destino=snapshot) == 1
    assert snapshot.read_text(encoding="utf-8") == contenido_obsoleto
    assert "desactualizado" in capsys.readouterr().err
