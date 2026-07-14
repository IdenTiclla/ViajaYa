"""Pruebas del contorno autoritativo de Bolivia."""

from __future__ import annotations

import pytest

from app.domain.exceptions import InvalidLocationError
from app.domain.service_area import bolivia_covers
from app.domain.value_objects import ServiceAreaPoint


@pytest.mark.parametrize(
    ("name", "latitude", "longitude"),
    [
        ("La Paz", -16.4897, -68.1193),
        ("Santa Cruz", -17.7833, -63.1821),
        ("Cobija", -11.0267, -68.7692),
        ("Tarija", -21.5355, -64.7296),
    ],
)
def test_bolivian_cities_are_inside_service_area(
    name: str, latitude: float, longitude: float
) -> None:
    point = ServiceAreaPoint(latitude, longitude, "BO")

    assert point.latitude == latitude, name
    assert bolivia_covers(latitude, longitude)


@pytest.mark.parametrize("country_code", [None, "BO"])
@pytest.mark.parametrize(
    ("name", "latitude", "longitude"),
    [
        ("La Quiaca", -22.104, -65.596),
        ("Corumba", -19.008, -57.652),
        ("Fuerte Olimpo", -21.041, -57.873),
    ],
)
def test_neighbouring_cities_are_rejected_even_if_client_claims_bolivia(
    name: str,
    latitude: float,
    longitude: float,
    country_code: str | None,
) -> None:
    with pytest.raises(InvalidLocationError, match="Bolivia"):
        ServiceAreaPoint(latitude, longitude, country_code)

    assert not bolivia_covers(latitude, longitude), name


def test_service_area_includes_country_border() -> None:
    # Vertice exacto del contorno versionado: la operacion debe ser covers, no contains.
    assert bolivia_covers(-17.506588, -69.510089)
    ServiceAreaPoint(-17.506588, -69.510089)
