"""Pruebas del contrato entrante para nombres legibles de ubicaciones."""

import pytest
from pydantic import ValidationError

from app.api.v1.schemas.rides import PointInputSchema, PointSchema


def test_promueve_direccion_real_si_el_nombre_es_provisional() -> None:
    point = PointInputSchema(
        latitude=-16.5101,
        longitude=-68.1262,
        name="Ubicación seleccionada",
        address="Av. Arce 123, La Paz",
        country_code="BO",
    )

    assert point.name == "Av. Arce 123"


def test_rechaza_placeholder_si_solo_hay_coordenadas() -> None:
    with pytest.raises(ValidationError, match="Falta obtener un nombre legible"):
        PointInputSchema(
            latitude=-16.5101,
            longitude=-68.1262,
            name="Ubicacion seleccionada",
            address="-16.51010, -68.12620",
            country_code=None,
        )


def test_rechaza_coordenadas_enteras_como_direccion() -> None:
    with pytest.raises(ValidationError, match="Falta obtener un nombre legible"):
        PointInputSchema(
            latitude=-16,
            longitude=-68,
            name="Ubicación seleccionada",
            address="-16, -68",
            country_code="BO",
        )


def test_schema_de_respuesta_tolera_filas_historicas() -> None:
    point = PointSchema(
        latitude=-16.5101,
        longitude=-68.1262,
        name="Ubicación seleccionada",
        address="-16.51010, -68.12620",
        country_code="BO",
    )

    assert point.name == "Ubicación seleccionada"


def test_reemplaza_direccion_provisional_con_nombre_real() -> None:
    point = PointInputSchema(
        latitude=-16.5101,
        longitude=-68.1262,
        name="Av. Arce 123",
        address="Ubicación seleccionada",
        country_code="BO",
    )

    assert point.address == "Av. Arce 123"
