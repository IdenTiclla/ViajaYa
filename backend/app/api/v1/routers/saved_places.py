"""Endpoints de lugares guardados: listar, crear, actualizar y eliminar."""

from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, status

from app.api.deps import (
    CurrentUserDep,
    get_create_saved_place,
    get_delete_saved_place,
    get_list_saved_places,
    get_update_saved_place,
)
from app.api.v1.schemas.saved_places import SavedPlaceResponse, SaveSavedPlaceRequest
from app.application.dto import LocationInput, SaveSavedPlaceInput
from app.application.use_cases.create_saved_place import CreateSavedPlace
from app.application.use_cases.delete_saved_place import DeleteSavedPlace
from app.application.use_cases.list_saved_places import ListSavedPlaces
from app.application.use_cases.update_saved_place import UpdateSavedPlace

router = APIRouter(prefix="/saved-places", tags=["saved-places"])


def _to_input(body: SaveSavedPlaceRequest) -> SaveSavedPlaceInput:
    return SaveSavedPlaceInput(
        label=body.label,
        category=body.category,
        location=LocationInput(
            latitude=body.location.latitude,
            longitude=body.location.longitude,
            name=body.location.name,
            address=body.location.address,
            country_code=body.location.country_code,
        ),
    )


@router.get("", response_model=list[SavedPlaceResponse])
async def list_saved_places(
    current_user: CurrentUserDep,
    use_case: Annotated[ListSavedPlaces, Depends(get_list_saved_places)],
) -> list[SavedPlaceResponse]:
    places = await use_case.execute(current_user.id)
    return [SavedPlaceResponse.from_entity(p) for p in places]


@router.post("", response_model=SavedPlaceResponse, status_code=status.HTTP_201_CREATED)
async def create_saved_place(
    body: SaveSavedPlaceRequest,
    current_user: CurrentUserDep,
    use_case: Annotated[CreateSavedPlace, Depends(get_create_saved_place)],
) -> SavedPlaceResponse:
    place = await use_case.execute(current_user.id, _to_input(body))
    return SavedPlaceResponse.from_entity(place)


@router.put("/{place_id}", response_model=SavedPlaceResponse)
async def update_saved_place(
    place_id: uuid.UUID,
    body: SaveSavedPlaceRequest,
    current_user: CurrentUserDep,
    use_case: Annotated[UpdateSavedPlace, Depends(get_update_saved_place)],
) -> SavedPlaceResponse:
    place = await use_case.execute(current_user.id, place_id, _to_input(body))
    return SavedPlaceResponse.from_entity(place)


@router.delete("/{place_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_saved_place(
    place_id: uuid.UUID,
    current_user: CurrentUserDep,
    use_case: Annotated[DeleteSavedPlace, Depends(get_delete_saved_place)],
) -> None:
    await use_case.execute(current_user.id, place_id)
