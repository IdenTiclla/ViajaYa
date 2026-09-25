# Flat maps, fixed camera and close framing

2026-09-19 · Implemented and verified locally · `codex/ui-improvements-and-bugfixes`.

- Remove extruded buildings and dark outlines when zooming in, in both themes.
- Lock gestures on the driver's waiting map and anchor the radar to the
  projection of its GPS coordinate, including position and size changes.
- Remove the two top A/B blocks from configure; keep accessible editing
  and the markers on the route.
- Tighten the framing of full routes for both roles, using smaller margins
  and the real panel sizes. Do not change route choice or contracts.
- Verify projection/camera, maps with adapters, configure across
  services, mobile tests, TypeScript/lint and the Android bundle. Distinguish what is
  automated from the cartographic finish pending on a phone.

## Result

- The seven maps disable `showsBuildings`. The common style sets the building
  fill to the theme's ground color and hides their outlines, also
  when place names are enabled. Manual point selection keeps
  its gestures; the driver/passenger waiting and route maps are locked.
- The driver's waiting map no longer enables interactive mode. The radar lives inside
  the map and uses the native projection of the same GPS as the vehicle, with a size
  bounded to the container. It reprojects when location, size or camera change;
  it ignores earlier responses and hides without coordinates or a valid projection.
- Camera tracking uses `setCamera` without animation, north up and without
  tilt; there is no state that turns off when dragging.
- The two top A/B blocks of configure and the space they
  reserved are removed. The markers keep their existing edit actions.
  Configure frames with 24 top/bottom and 32 on the sides, keeping the size
  of the panel and map when switching taxi, moto, parcels or moving.
- Tracking/negotiation uses compact margins of 40 vertical/44 horizontal;
  long addresses keep 72/88. The whole polyline is considered, including
  curves, and the values sent to Android are integers.
- Requests on the map measures its header. Offer sent measures header/panel and
  keeps the panel at 64 %, instead of estimating 440 over a variable panel
  that could take 82 %. The route keeps its space and its actions scroll
  inside the panel. Negotiation, ETA and optimal route choice do not change.

## Evidence of 2026-09-19

- **377 mobile tests passing**, including four new ones for close framing
  and fractional measures; style tests extended to buildings in both
  themes and place-selector states. TypeScript/lint clean.
- **17 new UI cases:** configure and four services in light/dark;
  ten views with a route (five per service); radar projection offset
  from the screen center, size change, late GPS responses
  and loss of coordinates; configure at 320×640 with 200 % text.
- **41 previous UI cases passing again:** 14 of experience, 23 of
  negotiation and four of pagination. Total **58**, without JavaScript errors.
- Screenshots inspected for configure, waiting, requests and tracking
  of both roles. Production maps/screens/hooks with the native surface, routes,
  GPS, network and navigation adapted; the simulated geometry keeps proportions.
- API/Metro HTTP 200; updated Android bundle of **11,909,836 bytes**, with the new camera and
  projection. API/Metro were not restarted and no emulator was opened.
- No Android connected via ADB: verifying native cartography,
  shading when zooming, projection on Google Maps and appearance with real GPS is still pending.
  The preview does not certify the provider's building bitmaps.
- Plan and presentation at revision 20: 32 slides verified, without
  overflow or JavaScript errors; navigation, reading, printing and a
  download identical to the plan passed.
- Backend and contracts unchanged. Historical evidence of revision 17 kept.

Reproducible files, logs and screenshots:
`local-files/map-framing-2026-09-19/`.

References: [Expo Maps 56](https://docs.expo.dev/versions/v56.0.0/sdk/map-view/),
[Google Maps styles](https://developers.google.com/maps/documentation/javascript/style-reference).
The installed react-native-maps 1.27.2 implementation was also reviewed to
confirm logical projection units and building/camera availability.
