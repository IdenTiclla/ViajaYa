"""Geographic outline of the area where ViajaYa operates.

Source: Natural Earth, ``Admin 0 - Countries`` at 1:10m scale, a
public-domain dataset. The GeoJSON was extracted from the reproducible commit
``ca96624a56bd078437bca8184e78163e5039ad19`` of:
https://github.com/nvkelso/natural-earth-vector/tree/ca96624a56bd078437bca8184e78163e5039ad19/geojson
"""

from __future__ import annotations

import json
from functools import cache
from importlib.resources import files

Point = tuple[float, float]

_BOUNDARY_RESOURCE = "bolivia_admin0_ne10m.geojson"
_EPSILON = 1e-10


@cache
def _bolivia_ring() -> tuple[Point, ...]:
    """Load the versioned outline once (coordinates in longitude/latitude order)."""

    resource = files("app.domain.data").joinpath(_BOUNDARY_RESOURCE)
    feature = json.loads(resource.read_text(encoding="utf-8"))
    if feature.get("properties", {}).get("iso_a3") != "BOL":
        raise RuntimeError("The operating area outline does not correspond to Bolivia.")
    geometry = feature.get("geometry", {})
    if geometry.get("type") != "Polygon":
        raise RuntimeError("The Bolivia outline must be a GeoJSON polygon.")
    coordinates = geometry.get("coordinates", [])
    if not coordinates or len(coordinates[0]) < 4:
        raise RuntimeError("The Bolivia outline is empty or incomplete.")
    return tuple((float(x), float(y)) for x, y in coordinates[0])


def _point_is_on_segment(point: Point, start: Point, end: Point) -> bool:
    px, py = point
    ax, ay = start
    bx, by = end
    cross = (px - ax) * (by - ay) - (py - ay) * (bx - ax)
    scale = max(1.0, abs(bx - ax), abs(by - ay))
    if abs(cross) > _EPSILON * scale:
        return False
    return (
        min(ax, bx) - _EPSILON <= px <= max(ax, bx) + _EPSILON
        and min(ay, by) - _EPSILON <= py <= max(ay, by) + _EPSILON
    )


def _ring_covers(point: Point, ring: tuple[Point, ...]) -> bool:
    """Ray casting with the boundary included, equivalent to the GIS ``covers`` operation."""

    px, py = point
    inside = False
    previous = ring[-1]
    for current in ring:
        if _point_is_on_segment(point, previous, current):
            return True

        ax, ay = previous
        bx, by = current
        if (ay > py) != (by > py):
            crossing_x = ax + (py - ay) * (bx - ax) / (by - ay)
            if crossing_x > px:
                inside = not inside
        previous = current
    return inside


def bolivia_covers(latitude: float, longitude: float) -> bool:
    """Return ``True`` for interior points or points on the boundary."""

    return _ring_covers((longitude, latitude), _bolivia_ring())
