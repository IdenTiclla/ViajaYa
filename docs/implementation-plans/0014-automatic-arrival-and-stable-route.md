# Automatic ETA, closing and stable map

2026-09-19 · Implemented and verified locally · `codex/ui-improvements-and-bugfixes`.

Fixes requested after testing the flow on a device:

- Rating the passenger must close the ride without turning an internal query
  cancellation into «No pudimos verificar tus viajes».
- The five offer/re-offer entry points compute the ETA from a recent location
  of the driver to the pickup. There is no manual entry or invented minutes.
  An unavailable location or route shows a recoverable error and does not send the offer.
- Request routes with traffic (`TRAFFIC_AWARE_OPTIMAL`) and alternatives; choose the shortest
  valid duration and, on a tie, the shortest distance. Moto uses `TWO_WHEELER`; other
  services `DRIVE`; parcel pickup uses the driver's active vehicle.
  «Optimal» means the fastest among the alternatives the provider returns
  at that moment; it does not guarantee knowing incidents the provider has not reported yet.
- Switching service does not change the panel height or recompute the framing with a
  provisional straight line. Locked top-down map: no dragging, zoom or rotation. The
  whole geometry is framed and label placement is stabilized. The form
  keeps scrolling for accessibility on small screens and with large text.
- Verify cache/cancellation, ETA/GPS/errors, routes, service changes,
  types, lint, screens and the Android bundle. Update evidence and presentation.

Sources: [Expo Location 56](https://docs.expo.dev/versions/v56.0.0/sdk/location/),
[Google routing preferences](https://developers.google.com/maps/documentation/routes/reference/rest/v2/RoutingPreference),
[computeRoutes](https://developers.google.com/maps/documentation/routes/reference/rest/v2/TopLevel/computeRoutes).


## Result and evidence

- **Driver closing:** `actualizarTrasCalificacion` (now `refreshAfterRating`) waits for the local
  cancellations to finish before clearing active/pending. The screen does not
  cancel those queries again after saving the rating. The previous regression
  fails with `error !== success`; afterwards it passes and Requests opens directly.
  Later invalidations keep running in the background, without waiting for another network call.
- **Automatic ETA:** the five offer/re-offer paths query a current
  position (at most 30 s old and accurate up to 200 m), compute driver → pickup
  and round the duration up. The manual minutes field is removed.
  Denied permission, disabled/old/inaccurate GPS and a missing route prevent
  publishing an invented ETA. The same computation respects moto for parcels
  when that is the driver's active vehicle.
- **Routes:** Google receives `TRAFFIC_AWARE_OPTIMAL`, alternatives and a high-quality
  polyline. Each alternative is validated and the shortest time is chosen; distance breaks ties.
  The cache is shared by vehicle mode and coordinates: taxi/parcel/moving
  reuse `DRIVE`, moto keeps `TWO_WHEELER`. When the profile changes, the geometry
  of the same endpoints is kept temporarily with «Actualizando ruta…».
  A straight line is not drawn as if it were a computed route.
- **Map:** configure has its own area, a stable-height panel and editable A/B
  labels outside the camera. Route maps lock dragging, rotation and
  zoom; the framing considers the whole geometry, also if it changes without changing its
  number of points. The service selector uses two columns without overflow.
  The form can scroll to reach every control with large text.

**Checks of 2026-09-19:**

- **329 mobile tests passing**; TypeScript and lint without errors or warnings.
- **25 interface cases:** ten ETA submissions (five paths × taxi/moto), two closings
  with old pending queries, a GPS error with retry and twelve service
  changes (four services × three size/theme/text-scale configurations).
  Labels and CTA keep exactly their rectangles across services. Tested at
  390×844 and 320×640, light/dark themes and text up to 200 %. No JavaScript errors.
- **Real Google Routes:** HTTP 200 for `DRIVE` and `TWO_WHEELER`, with three alternatives
  per mode, on synthetic La Paz coordinates. Times, distances
  and number of points are recorded; no keys. It checks provider compatibility and the
  current configuration, not a guarantee of future traffic or truck restrictions.
- **Android:** full bundle HTTP 200, **11,893,148 bytes**. API `/health/ready` and
  Metro healthy. No services were restarted; neither the backend nor the database changed.
- **Plan/presentation:** revision 14. The backend figures of revision 13 remain
  as earlier evidence; this fix affects mobile and does not re-attribute them
  to a new run.

Local evidence: `local-files/automatic-arrival-route-2026-09-19/`.
The viewer keeps screens, hooks, React Query and the route logic; it replaces
GPS/HTTP/navigation and the native map with a framing viewer. The Google queries
are an independent check. Validating real GPS, Google Maps rendering and the native keyboard
with this version on the user's phones is still pending.
