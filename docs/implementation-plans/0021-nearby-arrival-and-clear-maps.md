# Nearby arrival and clean maps

2026-09-19 · Implemented; local verification recorded below and native cartography pending · `codex/ui-improvements-and-bugfixes`.

## Reproduced problems

- When offering next to the passenger, Google returns HTTP 200, duration `0s`, a single
  point and omits `distanceMeters` because it is zero. The selector required two points and
  an explicit distance; it rejected that valid response and showed a false connection
  error. Reproduced with taxi and mototaxi, coincident coordinates and
  coordinates about 4 m apart. Normal queries also responded correctly.
- Configure started the map below a 64 strip plus the safe area,
  even though the top controls were already floating.
- Search without offers reserved 160 at the top and a duplicated bottom margin. The
  sheet could cover 88 %; with large text, the moto notice covered the route and
  the Cancel button clipped its text.
- The user again observed darkening when zooming in the light theme. Revision
  20 disabled 3D buildings and recolored footprints, but still left
  terrain/POI geometries and interiors; the selectors allowed tilt.
  With no phone connected, the visual effect is not attributed to a single layer.

## Changes

- Accept a single point exclusively on stationary routes with zero duration and
  distance; normalize an omitted distance only in that case. Geographic
  validation and choosing the fastest alternative are kept.
- Arrival computed automatically; the contract minimum is still 1 min.
  No geometry is invented and a moto route is not replaced by a car one. On maps,
  the framing uses the ride's points if the response has a single point and
  does not draw a line as if it were a computed route.
- Separate unavailable provider, nonexistent route, incomplete response,
  timeout and connection failure; keep aborts. The map query ends
  without prolonged automatic retries and keeps an explicit retry.
- Configure map from the top edge; Back and places on top, with the
  real header height to protect the markers. Stable panel when switching
  service. Search uses measured header/panel and a sheet of at most 64 % with
  internal scrolling. Moto notice inside the sheet; cancel and the offer
  field grow with the text. Top controls and retry of at least 48.
- The seven maps disable buildings, interiors, level picker and
  tilt. The common style hides the geometry of buildings, relief
  and POIs, keeps parks and streets, and separates the place-names control.
  The selectors' zoom is not limited and no veil is added over the map.

## Evidence

- **396 mobile tests passing**, 19 new ones compared to revision 20: HTTP client
  integration, parser and offer publication with the real nearby response;
  provider/network/timeout/cancellation errors; geometry validation; an inventory
  of every MapView site to avoid re-enabling layers and tilt.
- **Six real queries with the production route code passing:** taxi and
  moto at the same point, a few meters apart and on a normal trip. No remote
  rides or offers were created. Before/after evidence without keys or tokens.
- **68 UI cases passing:** ten new ones for controls over the map in both
  themes, taxi/moto search at 390×844 and 320×640 with 200 % text, nearby arrival
  and error recovery; 17 of maps, 14 of experience, 23 of negotiation and
  four of pagination. No JavaScript errors. Screenshots inspected.
- TypeScript, lint and `git diff --check` clean. API and Metro HTTP 200; updated
  Android bundle of **11,913,183 bytes**, without restarting services. No emulator was created.
- Production screens/hooks, with the map/GPS/network/navigation surface adapted
  in the UI tests: they check space, camera, props and actions, **not** the
  shading of the Google Maps tiles. ADB without devices. Visually confirming
  close zoom in the light theme on the user's phone is still missing, both
  when selecting locations and in configure, waiting and tracking.
- Plan/presentation in sync at revision 21: 32 slides verified on
  desktop/mobile; navigation, reading, printing and an exact plan download
  passed. Backend and contracts unchanged;
  the backend/PostgreSQL evidence of revision 17 is kept as historical.

Reproducible evidence: `local-files/arrival-map-2026-09-19/`.

References: [Expo 56](https://docs.expo.dev/versions/v56.0.0/),
[default fields omitted in Google Routes](https://developers.google.com/maps/documentation/routes/choose_fields),
[Google Maps Android styles](https://developers.google.com/maps/documentation/android-sdk/style-reference).
The installed Android bridge of react-native-maps 1.27.2 was also reviewed to
confirm how properties are sent to the native map and their default values.
