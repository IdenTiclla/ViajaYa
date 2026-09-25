# Gap review and fixes: taxi and mototaxi

Date: 2026-09-19. Branch: `codex/ui-improvements-and-bugfixes`, uncommitted.
**Current status: H01–H05 fixed and verified locally; manual ETA and per-service routes implemented.**
Certification on two phones is still pending.

> File and component names below are historical (before the 2026-09 English renaming).

## Later extension: pickup and shared experience

**Revision 13** completes the sequence arrival → «ya salí» → start on board → closing
→ rating. It fixes acceptance with a lost response, an offer that expires during its
confirmation, a double tap on the notice and late snapshots on reconnect. The notice
is stored and delivered to both participants; it is not interpreted as boarding.

New evidence: **721 backend**, **311 mobile**, **4 PostgreSQL**, **40 views + 16
dialogs**, API/WS contract and migration `0030`. [Detail and certification limits](../implementation-plans/0013-passenger-driver-pickup-experience.md).

## Result of the fixes

| Finding | Fix and evidence |
|---|---|
| H01 · Editing | Queries the ride after losing the response. If it was already published, it releases the navigation lock and recovers offers, ride or closing depending on its status. If it is still paused, it keeps the form. |
| H02 · Finishing | Recovers the terminal detail. The driver's query also resolves the pending closing before opening the pool; a failure of that read keeps the error and does not enable new requests. |
| H03 · Creation | Queries the active request when the POST fails and opens the existing ride. Without proof of saving it keeps the error and the draft. |
| H04 · Rating | New `GET /api/v1/rides/{ride_id}/rating`: returns only the authenticated participant's rating for that ride. It allows recognizing a save even if the response is lost; it does not interpret any 409 as success. |
| H05 · Vehicle | Snapshot of ID, type, plate and model inside the atomic assignment. Detail, events and history use that snapshot. Migration 0029 recovers only vehicles of active rides; historical rows without evidence stay without vehicle data. |
| ETA | The five offer/re-offer paths ask for between 1 and 240 minutes to the pickup, without an invented value. The origin→destination duration is still separate. |
| Routes | `moto` requests `TWO_WHEELER`; taxi uses `DRIVE`. Separate cache per service and a moto-route notice in testing. A provider error is not replaced by a car route. |

### Validation of the fix

- Full backend: **717 passing, 80 skipped** due to optional requirements; five pre-existing warnings. After the final persistence adjustment, the affected API/WS suite passes again: **64 passing**.
- Isolated PostgreSQL: **2 migration tests** with taxi/moto and the five ride stages; upgrade/downgrade/upgrade verified. Additive migration applied to the local database, without restarting services.
- Mobile: **303 passing**; TypeScript and lint without errors. OpenAPI contract generated and checked in both projects.
- Real screens, hooks and React Query: **16 cases** (create, edit, complete, rate × taxi/moto × failure before/after saving). There is no false closing when the server did not save.
- ETA: **10 submission flows** (five paths × two services) and **8 reviews** of size/theme/enlarged text. Cancelling does not send an offer; empty or out-of-range values do not enable sending.
- Google Routes: tests of the payload per service, geometry, failure without replacing with a car and cache separation. Real provider routes and street driving were not certified.
- Full Android bundle: HTTP 200, **11,874,244 bytes**. API and Metro healthy; it is not equivalent to generating an updated APK.

Local reproducible evidence: `local-files/taxi-mototaxi-fixes-2026-09-19/`.
The browser tests replace network, map and native navigation to control the failures. The API, WebSocket and migration tests run separately. Testing the dev build on two phones is still pending, including disconnection, keyboard, TalkBack, maps and native contacts.

## Original findings and reproduction before the fixes

The following H01–H05 sections keep the description and references of the initial audit; they do not describe failures that are still open.

## Prioritized findings

### H01 · P1 · Saving an edit can leave the passenger trapped in the form

**Trigger:** the server saves `PATCH /rides/{id}` and republishes the
request (`paused=false`), but the response does not reach the phone.

**Reproduction:** create → pause to edit → save → lose the HTTP response
after the commit → query the detail again → tap Save again.
The backend responds 409, «Debes pausar la solicitud antes de editarla». The screen
stays in editing even though it already knows `paused=false`. Going back opens «¿Cancelar la
solicitud?»; there is no exit that continues that negotiation without cancelling it.

**Cause:** `ConfigureTripScreen.tsx:371–383` only navigates from `onSuccess`; the
exit lock of `:181–183` depends on the `rideId` parameter, not on whether the server
is still paused. The later GET hydrates the form only once, but does not
reconcile its stage.

**Impact:** an already published request can be cancelled by accident to
leave an edit that finished. It affects both taxi and mototaxi.

**Proposed fix:** resolve the screen from the authoritative state when
the connection recovers. A published request must go back to offers; an assigned one,
to the ride. Keep the draft if the save really failed.

### H02 · P1 · A finish with a lost response skips the driver's closing

**Trigger:** WebSocket unavailable and HTTP response lost after
the server moves to `completed`.

**Reproduction:** in the real `SolicitudesEntrantesScreen` component, finish
an `in_progress` ride, save the change in the simulated repository and reject
the response. Result: the active GET returns `null`, «Esperando
nuevas solicitudes» is shown and the rating does not appear. The server keeps a pending
closing and `['pending-rating-ride']` stays `null`.

**Cause:** `useTripActions.ts:30–34` invalidates detail and active rides, but not the
pending rating. The driver has no active detail observer;
invalidating it does not trigger that GET. `usePendingRatingRide` has no polling, and the
screen enables the pool when active and pending are null
(`SolicitudesEntrantesScreen.tsx:96–110`).

**Evidence:** observed queries: `active → pending → active → pool`; a
second pending query is missing. The real FastAPI contract returns active `null`
and the completed ride in `/rides/me/pending-rating`.

**Proposed fix:** also reconcile the pending closing and keep the
recovery screen until it is resolved before going back to the pool. Test with the
parent and the real query hooks, in addition to the ride card.

### H03 · P2 · A creation with a lost response does not recover the created request

**Reproduction:** `POST /rides` commits on the server, the phone receives a network error;
on retry, it gets 409 «Ya tienes una solicitud o un viaje activo». The user
stays on Configure ride and does not see the offers of their existing request.

**Cause:** `ConfigureTripScreen.tsx:136–148` only invalidates the active ride and navigates to
offers in `onSuccess`. It does not reconcile an uncertain result. Home's recovery
runs when focus returns, not from the form on top of it.

**Impact:** the request stays active and can receive offers while its owner
thinks it could not be created. Going back Home allows recovering it, but repeating Buscar
ofertas does not resolve the error.

**Proposed fix:** after an uncertain creation result or a conflict because of an
active ride, query the current ride and continue its stage; keep the form
only if it is confirmed that no request was created.

### H04 · P2 · A saved rating can leave the card in a permanent error on retry

**Reproduction:** send five stars → saved on the server → lose the response
→ send again. Real API result: 409 «Ya calificaste este viaje».
The screen stays open; `onDone` never runs.

**Cause:** `useCloseFlow.ts:43–49` updates pending ones only from `onSuccess`.
`RideRatingCard.tsx:53–66` catches the error without checking whether the
rating already exists. The detailed ride does not report the actor's rating.

**Impact:** the user has to resort to Skip or leave/reopen to abandon a
closing they already completed. It does not duplicate the rating: the backend protects that case.

**Proposed fix:** add explicit closing reconciliation or compatible
idempotent semantics. Confirm the existing rating before closing;
do not treat any 409 as success.

### H05 · P2 · The vehicle of an earlier ride changes when the active vehicle changes

**Reproduction with the real API:** register taxi `TAXI-123` and moto `MOTO-123` →
complete a ride by taxi → go offline → activate moto → query the ride
and the passenger's history. The service keeps `taxi`, but driver and
counterpart now show `moto`, `MOTO-123` and the moto's model. Also reproduced
in the reverse direction.

**Cause:** `GetRide.execute` (`get_ride.py:34–35`) rebuilds the driver from
the current user; `RideResponse.from_detail` (`schemas/rides.py:263–272`) uses their
active vehicle. History does the same in `repositories.py:732–787`.
The assignment does not keep a snapshot of the data of the vehicle used.

**Impact:** closing, historical identification and support show a vehicle that
did not make the ride. It can happen before the passenger opens their rating.

**Proposed fix:** store the vehicle's type, plate, model and identification
when assigning the ride and consume that snapshot in detail, closing and history.
Historical rides without a snapshot require an explicit policy; their original vehicle
cannot be deduced from the one active now.

## Gaps observed in the initial audit

- **Arrival ETA without a source in the app.** The five offer/re-offer paths in
  `SolicitudesEntrantesScreen.tsx:172–232` and `OfertaEnviadaScreen.tsx:145–171` send
  price and `acceptAtFare`, without `etaMin`. There is no driver input or computation
  from driver to pickup. `TarjetaOferta.tsx:73–75` ends up showing «Sin estimación».
  The API tests that provide `eta_min` manually do not validate this experience.
- **Mototaxi uses the same route as taxi.** `routesService.ts:45–49` pins `DRIVE`,
  and `useRoute.ts:18` shares the cache by coordinates, without service. There is no
  differentiation or certification of mototaxi routes. This does not prove that a
  specific route is wrong; it documents the absence of that capability.
- **Tracking and production operations pending:** shared GPS, background,
  navigation to pickup/destination, pickup by code, verifiable QR collection
  and incident support remain outside the local closing. They are pending items already
  identified in F04–F09, not implementations finished by revision 11.

## Reproduction evidence before the fix

- **Eight interface reproductions:** four lost-response scenarios ×
  taxi/mototaxi, without JavaScript errors. Real screens, React Query,
  `useRides`, `useTripActions`, mutations and stores were used. The HTTP repository, maps,
  location and native navigation were replaced to control the failure point.
- **Four isolated API checks:** repeated creation/editing and
  closing/rating/historical vehicle, parameterized for both services.
  Real FastAPI + test SQLite. Observed responses and states are verified;
  these reproductions passing confirms the failure, not that the product is fixed.
- No accounts, rides, local database or development processes in use were modified.
- The 289 mobile tests and 60 API/WS tests of the previous delivery did not cover these
  combinations. The previous viewer replaced `useRides` and did not mount the driver's real
  parent: that is why it did not detect H02. The earlier retry tests
  modeled errors before saving, not responses lost after the commit.
- Native behavior on two phones, map delivery and
  PostgreSQL races were not certified here. SQLite does not validate `FOR UPDATE` locks.

Local evidence: `local-files/taxi-mototaxi-gaps-2026-09-19/`.
It includes `findings.json`, screenshots, `browser-tests.log`, `api-tests.log`,
`test_api_contract.py` and the reproduction viewer/script. The lost-HTTP cases
simulate losing the response at the repository boundary; the contract they
follow was checked independently against the API.

The previous fix order has already been carried out. Native certification and the F04–F09 production pending items described in plan 0012 remain.


**Continuation, revision 14:** the user's tests detected an internal
cancellation error when rating as a driver and framing changes between
services. The manual ETA was replaced by an automatic GPS → pickup computation.
See [fix, traffic-aware routes and current evidence](../implementation-plans/0014-automatic-arrival-and-stable-route.md).
