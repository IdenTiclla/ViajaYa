# Functional closing of taxi and mototaxi

Date: 2026-09-19. Branch: `codex/ui-improvements-and-bugfixes`.
Status: five failures from the later review fixed and verified locally.
Manual ETA and separate routes for taxi/mototaxi implemented. Validation on two phones is missing.

Later review: [taxi/mototaxi gaps and bugs](../plans/taxi-mototaxi-gap-review-2026-09-19.md).
Priority: recovery after lost responses and keeping the historical vehicle.
The changes remain uncommitted.

## Scope of this delivery

Complete the current passenger and driver flow: choose service and route,
propose a price, negotiate and accept, pick up, start, finish, rate or
skip, recover the state and request/offer rides again. The contract
keeps `taxi` and `moto`; the interface names the `moto` service «Mototaxi».

## Verified criteria

- [x] Both participants can see service, route, agreed price,
  payment method and identification of the other party during the ride.
- [x] Arrival, start confirmation and finishing have clear actions;
  tapping several times or confirming a stale dialog does not advance another stage.
- [x] Communication failures allow retrying and recover the server
  state; failing to open a call, SMS or share has a visible response.
- [x] Cancellation before start, finishing, rating/skipping and history
  work for taxi and mototaxi. Stage changes reach both participants over WebSocket
  with the same content as the HTTP response.
- [x] Screens reviewed with small sizes, dark theme and enlarged text;
  TypeScript, lint, regressions and Android bundle checked.

## Changes

- Shared summary of service, pickup, destination, negotiated fare and payment
  method. The proposal keeps its label while the request searches for a driver.
- Driver: fixed main action, explicit arrival and confirmation of the passenger's
  identity before starting. Finishing requires confirming arrival at the destination.
- Dialogs are tied to the ride ID and stage. Actions and
  rating/skipping have an immediate lock against repeated submissions.
- An HTTP failure queries the detail and active views again: if the server
  saved the change but the response was lost, the app recovers the real state.
- The passenger can go back to the offers if they recover a request that is searching.
  Closing a ride only removes its ID from the cache; any other active one is kept.
- Call, SMS and share errors are visible. The yellow arrival notice
  keeps contrast in dark theme; long data and contacts wrap.
- The estimated pickup-to-destination duration is distinguished from the arrival time
  offered by the driver. Neither is presented as live GPS tracking.
- The map waits for size and native readiness before framing, updates when
  coordinates change and adapts its margins to the panel without losing all the usable area.

## Fix from the later review

H01–H05 resolved: recover publication when editing, keep the driver's closing,
recover creation/rating and pin the historical vehicle on acceptance. Added
`GET /rides/{ride_id}/rating` with per-participant authorization and the additive
migration `0029_ride_vehicle_snapshot`. Historical rows without evidence are not filled
with the current vehicle. Old queries are discarded when saving or acknowledging the closing.

The five offer paths request a manual pickup ETA between 1 and 240 minutes.
Routes and their cache distinguish taxi (`DRIVE`) from moto (`TWO_WHEELER`); the
moto-route notice is shown in testing. It is not equivalent to integrated navigation or shared GPS.

Evidence: **717 backend tests**, **2 PostgreSQL migration tests**, **303 mobile**,
16 lost/unsaved response cases with real screens and hooks, 10 ETA
flows and 8 visual reviews of the dialog. TypeScript, lint and OpenAPI passing.
Final Android bundle: **11,874,244 bytes**; API and Metro still healthy.
Plan and presentation updated to **revision 12**. F04 remains partial.

(Later superseded: plan 0014 replaced the manual ETA with an automatic GPS → pickup computation.)

[Detail of the fixes, tests and limits](../plans/taxi-mototaxi-gap-review-2026-09-19.md).
Local evidence: `local-files/taxi-mototaxi-fixes-2026-09-19/`.

## Evidence of the initial delivery

The later review found scenarios not covered by these tests; their
results do not certify closing findings H01–H05.

| Check | Result |
|---|---|
| `cd backend && .venv/bin/pytest tests/e2e/test_offers_flow_api.py tests/e2e/test_negotiation_ws.py -q` | **60 passing**. Both services: negotiation and assignment, valid stages, rejection of jumps/repetitions, recovery per role, rating, skipping, history and WS status events. Cancellation by passenger/driver in `accepted` and `arriving`; rejection in `in_progress`. |
| `cd backend && .venv/bin/ruff check .` | Passed. |
| `cd mobile && npm test` | **289 passing**. Includes six new map-framing regressions; the eight phone ones belong to the previous delivery on this branch. |
| `cd mobile && ./node_modules/.bin/tsc --noEmit` and `npm run lint` | Passed. |
| Real components + real React Query and mutations, with simulated repository/navigation | Pickup → confirmed start → closing → rating; cancellation; skipping; action/rating retry; lost HTTP response; stale dialog; ID change; contact errors. Taxi and mototaxi. No JavaScript errors. |
| Visual review | 24 combinations of driver/passenger/rating × 320/390 px × light/dark × text 100/200 %, and eight dialogs. No horizontal overflow; actions reachable; fixed main action. Screenshots inspected. |
| Metro Android bundle, full and without lazy loading | HTTP 200; **11,858,852 bytes**, includes the final actions and framing. Not equivalent to building an APK. |
| Local services | API `/health/ready` 200 with healthy PostgreSQL; Metro `packager-status:running`. Existing processes kept. |
| Plan and presentation | Revision 11 in sync; F04 remains partial and the integrated base is distinguished from the uncommitted local progress. |

The visual test uses React Native Web with simulated text scaling. It replaces
the map, contact APIs, repository and navigation; it keeps real screens, dialogs,
action/mutation hooks, React Query and cache reducers. The API and
WebSockets are tested separately with FastAPI and test SQLite.

Local evidence excluded from Git: `local-files/taxi-mototaxi-review-2026-09-19/`
(screenshots, local reproducible viewer, results and logs). The viewer uses the
Chromium/Playwright runtime available on this machine; it adds no dependencies to the product.

## Pending native validation

- [ ] On two phones with the current dev build: choose taxi, agree a fare,
  confirm arrival and identity, start and finish; rate in both roles.
- [ ] Repeat with mototaxi, including counter-offer, cancellation before start
  and skipping the rating. Check history and a new request.
- [ ] Cut/restore the connection, reopen the app and check recovery;
  review the native map, calls/SMS, keyboard, TalkBack and enlarged text.

The start confirmation is an explicit check by the driver; it does not replace
a future pickup verification by code. A finished ride does not prove
a payment either. Shared GPS, background, Navigation SDK, reconciled QR and production
certification keep the independent F04–F09 criteria of the launch plan.
The 120 s presence grace and the 30 s offer expiry are not modified.


## Continuation: shared pickup experience

Revision 13 adds a persistent «Ya salí» notice, offer confirmation, shared
progress and recovery from late snapshots. The current evidence of the
extended flow is in [plan 0013](0013-passenger-driver-pickup-experience.md).
Native certification on two phones and the F04 production closing remain pending.
