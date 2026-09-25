# Bolivia service boundary

`bolivia_admin0_ne10m.geojson` contains only the Bolivia polygon
extracted from Natural Earth, **Admin 0 - Countries**, 1:10m scale.

- Source: https://www.naturalearthdata.com/downloads/10m-cultural-vectors/10m-admin-0-countries/
- Repository: https://github.com/nvkelso/natural-earth-vector
- Commit: `ca96624a56bd078437bca8184e78163e5039ad19`
- License: public domain, according to Natural Earth.
- Extraction date: 2026-07-10.

Coordinates keep the GeoJSON `[longitude, latitude]` order. The backend
considers both the interior and the edge of the polygon valid.
