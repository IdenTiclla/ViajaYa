"""Tests unitarios de los casos de uso de lugares guardados (dobles en memoria)."""

from __future__ import annotations

import uuid

import pytest

from app.application.dto import LocationInput, SaveSavedPlaceInput
from app.application.use_cases.create_saved_place import CreateSavedPlace
from app.application.use_cases.delete_saved_place import DeleteSavedPlace
from app.application.use_cases.list_saved_places import ListSavedPlaces
from app.application.use_cases.update_saved_place import UpdateSavedPlace
from app.domain.entities import SavedPlaceCategory
from app.domain.exceptions import InvalidLocationError, SavedPlaceNotFoundError
from tests.fakes import InMemorySavedPlaceRepository


def _input(**over) -> SaveSavedPlaceInput:
    base = {
        "label": "Casa",
        "category": SavedPlaceCategory.HOME,
        "location": LocationInput(-16.5, -68.13, "Mi casa", "Calle 1"),
    }
    base.update(over)
    return SaveSavedPlaceInput(**base)


async def test_create_saved_place_persists():
    repo = InMemorySavedPlaceRepository()
    user_id = uuid.uuid4()

    place = await CreateSavedPlace(repo).execute(user_id, _input())

    assert place.user_id == user_id
    assert place.label == "Casa"
    assert place.category is SavedPlaceCategory.HOME
    assert place.location.address == "Calle 1"
    assert len(repo.places) == 1


async def test_create_saved_place_rejects_invalid_coordinates():
    repo = InMemorySavedPlaceRepository()
    with pytest.raises(InvalidLocationError):
        await CreateSavedPlace(repo).execute(
            uuid.uuid4(), _input(location=LocationInput(200.0, -68.0, "X", "Y"))
        )


async def test_list_saved_places_isolated_per_user():
    repo = InMemorySavedPlaceRepository()
    user_a, user_b = uuid.uuid4(), uuid.uuid4()
    await CreateSavedPlace(repo).execute(user_a, _input())

    assert await ListSavedPlaces(repo).execute(user_b) == []
    assert len(await ListSavedPlaces(repo).execute(user_a)) == 1


async def test_update_saved_place_changes_fields():
    repo = InMemorySavedPlaceRepository()
    user_id = uuid.uuid4()
    place = await CreateSavedPlace(repo).execute(user_id, _input())

    updated = await UpdateSavedPlace(repo).execute(
        user_id,
        place.id,
        _input(label="Trabajo", category=SavedPlaceCategory.WORK),
    )

    assert updated.id == place.id
    assert updated.label == "Trabajo"
    assert updated.category is SavedPlaceCategory.WORK


async def test_update_saved_place_rejects_other_user():
    repo = InMemorySavedPlaceRepository()
    owner = uuid.uuid4()
    place = await CreateSavedPlace(repo).execute(owner, _input())

    with pytest.raises(SavedPlaceNotFoundError):
        await UpdateSavedPlace(repo).execute(uuid.uuid4(), place.id, _input(label="Hack"))


async def test_delete_saved_place_removes_it():
    repo = InMemorySavedPlaceRepository()
    user_id = uuid.uuid4()
    place = await CreateSavedPlace(repo).execute(user_id, _input())

    await DeleteSavedPlace(repo).execute(user_id, place.id)

    assert repo.places == []


async def test_delete_saved_place_rejects_other_user():
    repo = InMemorySavedPlaceRepository()
    place = await CreateSavedPlace(repo).execute(uuid.uuid4(), _input())

    with pytest.raises(SavedPlaceNotFoundError):
        await DeleteSavedPlace(repo).execute(uuid.uuid4(), place.id)
