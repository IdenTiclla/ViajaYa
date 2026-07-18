"""Pruebas del snapshot OpenAPI versionado."""

from __future__ import annotations

import json

from scripts.export_openapi import OPENAPI_SNAPSHOT, main, serializar_openapi


def test_openapi_es_determinista_y_el_snapshot_esta_actualizado() -> None:
    primera_serializacion = serializar_openapi()
    segunda_serializacion = serializar_openapi()

    assert primera_serializacion == segunda_serializacion
    assert primera_serializacion.endswith("\n")
    assert primera_serializacion == OPENAPI_SNAPSHOT.read_text(encoding="utf-8")

    schema = json.loads(primera_serializacion)
    assert schema["info"] == {"title": "ViajaYa API", "version": "0.1.0"}
    assert "/api/v1/rides/open" in schema["paths"]


def test_openapi_marca_campos_nullable_del_pool_como_requeridos() -> None:
    schema = json.loads(serializar_openapi())
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


def test_check_detecta_drift_sin_reescribir(tmp_path, capsys) -> None:
    snapshot = tmp_path / "openapi.json"
    contenido_obsoleto = '{"contrato":"obsoleto"}\n'
    snapshot.write_text(contenido_obsoleto, encoding="utf-8")

    assert main(["--check"], destino=snapshot) == 1
    assert snapshot.read_text(encoding="utf-8") == contenido_obsoleto
    assert "desactualizado" in capsys.readouterr().err
