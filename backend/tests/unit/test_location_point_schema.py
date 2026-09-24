"""Tests of the incoming contract for human-readable location names."""

import pytest
from pydantic import ValidationError

from app.api.v1.schemas.rides import PointInputSchema, PointSchema


def test_promotes_the_real_address_if_the_name_is_provisional() -> None:
    point = PointInputSchema(
        latitude=-16.5101,
        longitude=-68.1262,
        name="Ubicación seleccionada",
        address="Av. Arce 123, La Paz",
        country_code="BO",
    )

    assert point.name == "Av. Arce 123"


def test_rejects_a_placeholder_if_there_are_only_coordinates() -> None:
    with pytest.raises(ValidationError, match="Falta obtener un nombre legible"):
        PointInputSchema(
            latitude=-16.5101,
            longitude=-68.1262,
            name="Ubicacion seleccionada",
            address="-16.51010, -68.12620",
            country_code=None,
        )


def test_rejects_whole_coordinates_as_an_address() -> None:
    with pytest.raises(ValidationError, match="Falta obtener un nombre legible"):
        PointInputSchema(
            latitude=-16,
            longitude=-68,
            name="Ubicación seleccionada",
            address="-16, -68",
            country_code="BO",
        )


def test_response_schema_tolerates_historical_rows() -> None:
    point = PointSchema(
        latitude=-16.5101,
        longitude=-68.1262,
        name="Ubicación seleccionada",
        address="-16.51010, -68.12620",
        country_code="BO",
    )

    assert point.name == "Ubicación seleccionada"


def test_replaces_a_provisional_address_with_the_real_name() -> None:
    point = PointInputSchema(
        latitude=-16.5101,
        longitude=-68.1262,
        name="Av. Arce 123",
        address="Ubicación seleccionada",
        country_code="BO",
    )

    assert point.address == "Av. Arce 123"
