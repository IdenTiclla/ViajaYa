# 0004 — Real-time offer negotiation (WebSocket) + atomic dispatch

> **Status: ⏳ Pending.** Replaces the polling of the offers flow (delivery 0002, already
> implemented) with **WebSocket** and adds **atomic dispatch** ("the first to accept wins")
> so a driver can make offers to several passengers in parallel without double assignments.
>
> It shares real-time infrastructure with plan **0003** (live location): both use
> `app/infrastructure/realtime/` and the socket auth helper. **If 0004 is implemented before
> 0003, it leaves the WS base ready**; if 0003 already exists, reuse it (do not duplicate `connection_manager`).
>
> File and component names below are historical (before the 2026-09 English renaming).

## Context

Today the negotiation is **polling** (React Query `refetchInterval` 3–4 s): `useRideOffers` (passenger),
`useOpenRides` and `useDriverActiveRide` (driver), `useRide` (both). It works, but with a
1–4 s delay, repeated `SELECT` queries that almost always return the same, and phone battery/data.

We want the **live open auction** model from the architecture document:

- The passenger sees offers **appear instantly** as drivers make them.
- The driver sees **new requests instantly** and can make offers to **several passengers at once**.
- **Golden rule:** the first passenger to tap **Accept** gets the driver; any second
  attempt on that driver receives a controlled error (409) and the app **removes the card**.
- On acceptance, **that driver's other live offers** (on other requests) are withdrawn by themselves and
  those passengers see them disappear from their screen in real time.

**Real state of the code (verified 2026-06-02):**
- There is **no** WS infrastructure: no `app/infrastructure/realtime/`, no `ws` router, nothing
  registered in `app/main.py` (only `auth`, `rides`, `drivers`, `saved_places`).
- `accept_offer.py` validates (owning rider, `SEARCHING` ride, `PENDING` offer valid for 30 s), marks the
  offer `ACCEPTED`, **rejects the rest of the same ride** (`reject_others`), assigns `driver_id` and moves
  the ride to `ACCEPTED`. It does **NOT** check that the driver is still free, does **NOT** withdraw the
  driver's offers on **other** requests, and does **NOT** use a row lock → possible double assignment if two
  passengers accept the same driver at the same time.
- `OfferRepository` has `add/get_by_id/update/list_by_ride/reject_others/reject_pending`. Each method
  does its own `commit()` (no multi-step transactional unit of work).
- Driver availability: **there is no "busy" column**; it is inferred from having an active ride
  (`get_driver_active_ride` looks at `ACCEPTED/ARRIVING/IN_PROGRESS`). We will keep that criterion.
- Two TTLs (memory [[oferta-expiry-model]]): **request 60 s**, **offer 30 s**. Counting and
  expiry are resolved **on the client** (`useCountdown`, `OfferLifeTimer`) and the backend filters
  expired ones on read. **This is kept**: the WS pushes discrete events (create/accept/withdraw/status),
  not expiry. (Later superseded: only offers expire; the request searches until cancelled.)
- Mobile auth: JWT Bearer via `core/http/client.ts`; token in `core/http/tokenStorage` (SecureStore).
- Backend with `uv`/Python 3.12; Postgres DB in `docker compose`; tests with SQLite (see §Risks).

**Architecture decisions:**
- **Mixed transport.** WS for **negotiation events** (offers and requests that appear/
  disappear, offer accepted, driver withdrawn). The **ride-in-progress status** and history
  stay on polling (they already work; 0003 adds GPS over WS separately).
- **Discrete events, not state.** The socket transmits *what changed* (`offer_created`, `offer_withdrawn`,
  `ride_created`, `ride_closed`, `offer_accepted`, `ride_status`). The client applies the change on the
  React Query cache; we do **not** redo the screen with every message.
- **Polling as a safety net.** A slow `refetchInterval` (~15–20 s) is kept as a fallback
  if the socket drops; with a live socket, fast refresh is disabled.
- **Atomic dispatch in the DB.** Acceptance becomes a **transaction with a row lock**
  (`SELECT … FOR UPDATE` in Postgres) that re-checks that the driver is still free before assigning.
- **One process, in-memory store.** The connection hub lives in the `uvicorn` process memory. Redis
  pub/sub is deferred to multi-process (same as 0003, see §Scaling).

---

## Target flow

```
Passenger publishes request ─POST /rides─▶ backend ─WS broadcast 'ride_created'─▶ online drivers (service pool)
Driver makes offer ─────────POST /rides/{id}/offers─▶ backend ─WS 'offer_created'─▶ passenger (new card)
Passenger accepts ──────────POST /rides/offers/{id}/accept─▶ atomic TX:
   ├─ success ─▶ 'ride_status: accepted' to the passenger  +  'offer_accepted' to the driver (→ navigation)
   │            +  'offers_withdrawn' to the driver         +  'offer_withdrawn' to the driver's OTHER passengers
   │            +  'ride_closed' to the pool (the request leaves the lists)
   └─ conflict (driver already taken) ─▶ HTTP 409 ─▶ the app removes that card
```

Subscriptions (topics) the in-memory hub keeps:
- `ride:{ride_id}` — the ride's owning **passenger** (receives offers and changes to their ride).
- `pool:{service_type}` — **online** drivers of that `vehicle_type` (taxi/moto) → new requests.
- `driver:{driver_id}` — the **driver** (receives "you were chosen" and "your other offers were withdrawn").

---

## Backend (`backend/`, Clean Architecture)

### 1. Real-time infrastructure — `app/infrastructure/realtime/` (new, shared with 0003)
- [ ] `connection_manager.py`: `RealtimeHub` with `topic -> set[WebSocket]`.
  - `subscribe(topic, ws)` / `unsubscribe(topic, ws)` / `unsubscribe_all(ws)`.
  - `async broadcast(topic, message: dict)` — serializes JSON and sends to each socket; drops and cleans
    up the ones that fail; removes empty sets. Tolerant to disconnection.
  - **Module singleton** (`hub = RealtimeHub()`) — lives in the `uvicorn` process.
- [ ] `ws_auth.py`: `authenticate_ws(token, users, tokens) -> User | None` — validates the access token
  (`JwtTokenService.decode_access_token`), loads the user; `None` if invalid. (Reusable by 0003.)
- [ ] Uniform message envelope: `{ "type": "<event>", "data": { … } }`.

### 2. Application — event publishing port
To avoid coupling the use cases to the transport, we define a **port** and publish **in the API layer**
(routers) after the use case succeeds, using the DTOs they already return. (Alternative: inject the
port into the use cases; ruled out to keep domain/use cases free of transport.)
- [ ] `app/application/interfaces.py`: `RideEventPublisher` port with high-level methods:
  `ride_created(ride)`, `ride_closed(ride_id, reason)`, `offer_created(ride_id, offer_detail)`,
  `offer_withdrawn(ride_id, offer_id)`, `offer_accepted(driver_id, ride_detail)`,
  `offers_withdrawn(driver_id, ride_ids)`, `ride_status(ride)`.
- [ ] Implementation `app/infrastructure/realtime/event_publisher.py`: `HubRideEventPublisher` that
  translates each method to `hub.broadcast(topic, {type, data})` with the topics above. It serializes with
  the **same Pydantic schemas** as the API (`OfferResponse`, `RideResponse`, `OpenRideResponse`) so
  the client receives exactly what it already understands.

### 3. Atomic dispatch — the central change
- [ ] `app/domain/exceptions.py`: new `DriverUnavailableError(DomainError)` ("El conductor ya aceptó
  otro servicio").
- [ ] `app/domain/repositories.py` — new methods:
  - `OfferRepository.list_pending_by_driver(driver_id) -> list[Offer]` (to know which other rides
    to notify and withdraw).
  - `OfferRepository.reject_by_driver(driver_id, keep_offer_id)` (rejects the driver's other `PENDING`
    offers on any ride).
  - `RideRequestRepository.get_active_for_driver(driver_id) -> RideRequest | None` (status in
    `{ACCEPTED, ARRIVING, IN_PROGRESS}`) — the "busy" criterion.
- [ ] **Atomic operation in the repo** `OfferRepository.accept_atomically(offer_id, rider_id) ->
  AcceptResult` — **a single transaction** (one `commit`):
  1. `SELECT … FOR UPDATE` of the offer and the driver (row lock in Postgres).
  2. Re-checks inside the lock: `PENDING` and valid offer, `SEARCHING` ride, **and the driver without an
     active ride** (`get_active_for_driver is None`). If busy → `DriverUnavailableError`.
  3. Chosen offer → `ACCEPTED`; `reject_others(ride_id, keep)`; `reject_by_driver(driver_id, keep)`
     (capturing the affected `ride_id`s beforehand to broadcast the withdrawal); ride → `ACCEPTED` with `driver_id`/
     `accepted_offer_id`.
  4. Returns `AcceptResult { ride, driver, accepted_offer, withdrawn_ride_ids: list[UUID] }`.
  > The use case's prior validation avoids useless work; the **re-check inside the lock**
  > is what guarantees the golden rule (it closes the TOCTOU window).
- [ ] `accept_offer.py`: keeps the authorization/ownership validations and delegates the commit to
  `accept_atomically`; returns an extended DTO with `withdrawn_ride_ids` for the router to broadcast.

### 4. API — WebSocket endpoint and event publishing
- [ ] `app/api/v1/ws/negotiation.py` (new): one socket per role/topic. Auth by **query param**
  `?token=<access_token>` (RN does not allow headers on `WebSocket`); validate with `authenticate_ws`;
  close `1008` if invalid. Create **one session per connection** (reuse `get_session`).
  (Later superseded: the token now travels in the `viajaya.auth` subprotocol, never in the URL.)
  - **Passenger** `@router.websocket("/ws/rides/{ride_id}")`: authorizes that they are the ride's `rider_id`;
    subscribes to `ride:{ride_id}` and `driver:`(N/A); on connect it sends an initial snapshot (the current
    valid offers) and stays subscribed. Cleanup on disconnect / terminal status.
  - **Driver** `@router.websocket("/ws/driver")`: authorizes the driver role; subscribes to
    `pool:{vehicle_type}` and `driver:{driver_id}`; on connect it sends the current open requests.
    (Only connect while **online**.)
  - Incoming client messages: not needed for the negotiation (the actions stay
    HTTP POST). The socket is **downstream only** for these topics → any incoming message is
    ignored except an optional `ping`. (In 0003 the driver does emit GPS over their own socket.)
- [ ] Register the WS router in `app/main.py` (`include_router(..., prefix="/api/v1")`).
- [ ] **Publish events from the existing HTTP routers** (`routers/rides.py`, `routers/drivers.py`),
  after the use case, via `RideEventPublisher` (injected in `deps.py` as a hub singleton):
  - `POST /rides` (create request, in its current router) → `ride_created` to `pool:{service_type}`.
  - `POST /rides/{id}/offers` → `offer_created` to `ride:{id}`.
  - `POST /rides/offers/{id}/accept` → `ride_status(accepted)` to `ride:{id}`; `offer_accepted` to
    `driver:{driver_id}`; `offers_withdrawn` to `driver:{driver_id}`; `offer_withdrawn` to each
    `ride:{withdrawn_ride_id}`; `ride_closed` to the `pool`.
  - `PATCH /rides/{id}/status` and `POST /rides/{id}/cancel` → `ride_status` to `ride:{id}`; if it becomes
    terminal, `ride_closed` to the pool and cleanup.
  - `POST /rides/{id}/keep-searching` → optional `ride_created`/refresh to the pool (stays visible).
- [ ] `api/deps.py`: `get_event_publisher` factory that returns `HubRideEventPublisher(hub)` (singleton);
  `Annotated` to inject it into the routers. `api/errors.py`: `DriverUnavailableError` → **409**.

### 5. Tests — `backend/tests/`
- [ ] `unit/test_accept_atomically.py`: the golden rule — two acceptances of the same driver, the
  second raises `DriverUnavailableError`; `reject_by_driver` withdraws the other `PENDING` ones and returns their
  `ride_id`s; a driver already with an active ride → rejection. Uses `tests/fakes.py` (extend the offers fake
  with `accept_atomically`, `list_pending_by_driver`, `reject_by_driver`).
- [ ] `e2e/test_negotiation_ws.py`: `TestClient.websocket_connect` (Starlette) —
  - a passenger connected to `/ws/rides/{id}` receives `offer_created` when a driver makes an offer over HTTP;
  - two passengers with offers from the same driver: one accepts (200) → the other receives `offer_withdrawn`
    and their accept POST returns 409;
  - the driver on `/ws/driver` receives `ride_created` when a request of their type is published and
    `offer_accepted` when chosen; an invalid token closes; a user outside the ride is rejected.
- [ ] Keep `e2e/test_offers_flow_api.py` green (the HTTP flow does not change its contract).

---

## Mobile (`mobile/`, Expo Router + `rides` feature)

### 1. Configuration — WebSocket URL
- [ ] In `core/config/env.ts` / `app.config.ts`: derive `wsUrl` from `apiUrl` (`http→ws`, `https→wss`).
  Do not read `process.env` at runtime (`CLAUDE.md` rule). (Shared with 0003.)

### 2. WS client — `core/realtime/` (new, shared with 0003)
- [ ] `socket.ts`: a generic `openSocket(path)` utility that opens
  `new WebSocket(`${wsUrl}${path}?token=${accessToken}`)` (token from `core/http/tokenStorage`), with
  **backoff reconnection**, parsing of the `{type, data}` envelope, and an `onMessage(cb)` / `close()` API.
  Handles `AppState` to reconnect when returning to the foreground.

### 3. WS → React Query bridge (key to not rewriting screens)
- [ ] `features/rides/application/useNegotiationSocket.ts` (passenger) and
  `useDriverPoolSocket.ts` (driver): open the right socket and, for each event, **mutate the React Query
  cache** with `queryClient.setQueryData` / `invalidateQueries`:
  - Passenger (`ride:{id}`): `offer_created` → adds to `['ride-offers', rideId]`; `offer_withdrawn` →
    removes it; `ride_status` → updates `['ride', rideId]` (and navigates to the ride on `accepted`).
  - Driver (`pool` + `driver`): `ride_created` → adds to `['open-rides']`; `ride_closed` → removes it;
    `offer_accepted` → sets `['driver-active-ride']` and navigates to the ride screen; `offers_withdrawn`
    → clears the `offered` state/cards in `useDriverRequests`.
- [ ] **Polling as a fallback:** in `useRides.ts`, lower the fast `refetchInterval`s to ~15–20 s
  (or `false` while the socket is connected, via a flag of the hook). Screens keep reading from
  React Query without structural changes.

### 4. Passenger UX — `features/booking/presentation/OffersScreen.tsx`
- [ ] Offer cards **appear/disappear live** (they come from the WS bridge). Keep the local
  30 s counters per card (`OfferLifeTimer`) and the 60 s one in the header (hidden if there are
  offers) — no changes to the expiry logic.
- [ ] **Accept with 409 handling:** when tapping Accept, if the backend responds **409**
  (`DriverUnavailableError`), remove that card and show a notice ("Ese conductor ya tomó otro
  viaje"); the rest of the offers stay available. On **200**, navigate to the ride in progress.
- [ ] Subtle connection state (e.g. "Conectando…" if the socket is reconnecting) without blocking the UI.

### 5. Driver UX — `features/driver/presentation/SolicitudesEntrantesScreen.tsx`
- [ ] Subscribe the socket **only while online**; requests come in/go out live (list and
  `SolicitudesMapa`). Reuse `useDriverRequests` (dismissed/offered) as is.
- [ ] **Parallel offers:** the driver can make offers on several requests at once (the backend already
  allows it; the `offered` state is per `rideId`). Quick increment buttons on the base fare
  (`+Bs.`) in `CounterOfferModal` (safe UX, no keyboard) — optional, recommended by the document.
- [ ] **Being chosen:** on receiving `offer_accepted`, navigate directly to `ViajeEnCursoConductorScreen`
  (do not wait for the `useDriverActiveRide` polling). On receiving `offers_withdrawn`, their other
  "waiting for the passenger" cards (`OfertaEnviadaScreen`) show that the offer no longer applies.

### 6. Contract in sync
- [ ] WS event types in `features/rides/domain/types.ts` (envelope + payloads, reusing the existing
  `Offer`/`Ride`/`OpenRide`). Mappers in `data/` if the payload differs from the HTTP DTO.

---

## Implementation order

1. **Backend infra:** `RealtimeHub` + `ws_auth` + `RideEventPublisher` port and `HubRideEventPublisher`.
2. **Backend atomic:** `DriverUnavailableError`, repo methods (`accept_atomically`,
   `list_pending_by_driver`, `reject_by_driver`, `get_active_for_driver`), `accept_offer` refactor.
   Unit tests of the atomic dispatch.
3. **Backend WS:** `ws/negotiation.py` router + registration in `main.py` + event publishing in the
   HTTP routers + factory in `deps.py` + 409 in `errors.py`. WS e2e tests.
4. **Mobile infra:** `wsUrl` + `core/realtime/socket.ts` client.
5. **Mobile bridge:** `useNegotiationSocket` / `useDriverPoolSocket` (WS → cache) and lower polling to
   a fallback.
6. **Mobile UX:** `OffersScreen` (live + 409) and `SolicitudesEntrantesScreen` (online + chosen).
7. Quality (`ruff`/`pytest`; `tsc`/`lint`) and a test with two sessions.

---

## Cleanup and leftovers (what is removed, repurposed or kept)

> Moving to WS is not just adding: we must **avoid leaving two sources of truth** (fast polling +
> socket) running at the same time, which would duplicate load/cost and cause cache flicker.

**Repurposed (not deleted):**
- [ ] `mobile/.../useRides.ts`: the fast `refetchInterval`s (`POLL_OFFERS_MS=3000`,
  `POLL_RIDE_MS=3000`, `POLL_OPEN_MS=4000`, `POLL_ACTIVE_MS=4000`) become a **slow fallback** (~15–20 s)
  or `false` while the socket is connected. Do **not** leave fast polling and the socket active at the
  same time. Rename/comment the constants to make it clear they are now a *fallback*.

**Removed if left over (verify before deleting):**
- [ ] Remains of earlier **heartbeat / AppState** attempts for the offer's life: the project's memory
  says that approach was **discarded**; confirm no dead code was left
  (`AppState` listeners, "still alive" timers) and remove it if it shows up. **Do not reintroduce it.**
- [ ] Imports, constants or helpers left **unused** after lowering the polling (e.g. if some hook
  no longer needs `refetchInterval`). Run `tsc`/`lint` to detect them.

**Kept (NOT a leftover, even if it looks like one):**
- [ ] `OfferRepository.reject_others` and `reject_pending`, the local `useCountdown` /
  `OfferLifeTimer` counters, and the backend's filtering of expired items: **expiry stays on the client** and the
  backend keeps filtering on read ([[oferta-expiry-model]]). The WS does not replace this.
- [ ] The HTTP offers flow (the current `POST`/`PATCH`es): **does not change its contract**; the WS only
  adds the event channel. `e2e/test_offers_flow_api.py` must stay green.

**Do not duplicate:**
- [ ] If plan **0003** already created `app/infrastructure/realtime/` (hub/auth) or `core/realtime/` in mobile,
  **extend** those modules instead of creating copies. A single hub serves negotiation and GPS.

---

## Verification (end to end)

**Backend**
```bash
cd backend && source .venv/bin/activate
docker compose up -d db            # from the root
alembic upgrade head
ruff check . && pytest             # unit (atomic) + e2e (HTTP + WS)
uvicorn app.main:app --reload --port 8000
```
Golden rule (Swagger + two WS clients): a driver makes offers to two passengers; the first to accept
receives 200; the second receives `offer_withdrawn` over WS and 409 when trying to accept.

**Mobile**
```bash
cd mobile && npx tsc --noEmit && npm run lint && npx expo start -c
```
Three sessions: 2 passengers + 1 driver. The driver (online) sees both requests live and makes offers on
both; each passenger sees the offer appear instantly; the first to accept starts the ride and for the
second the driver **disappears** from the screen.

---

## Risks / open decisions

- **`SELECT … FOR UPDATE` on SQLite (tests):** row locks are a *no-op* on SQLite; real atomicity
  is validated on Postgres. In tests, the single-threaded transaction is enough to cover the logic;
  document that the concurrency guarantee comes from Postgres. (Alternative: optimistic lock with a
  `WHERE status='searching'` clause in the `UPDATE` and checking `rowcount` — works on both.)
  **Recommended:** combine `FOR UPDATE` (Postgres) **and** the conditional `UPDATE … WHERE` as a portable
  guard.
- **Token in the WS URL:** acceptable with `wss://` (encrypted) and a short-lived access token; do not log
  the query. Same as 0003.
- **A single process:** the in-memory hub assumes 1 `uvicorn` worker. Multi-process → Redis pub/sub (§Scaling
  of 0003). The `RideEventPublisher` would stay behind the same port, changing only the implementation.
- **Expiry stays on the client:** the WS does not push expiry (there is no background task); the local
  60 s/30 s counters and the backend's filtering on read are kept. Do not reintroduce AppState logic
  for the offer's life ([[oferta-expiry-model]]).
- **Initial snapshot on connect:** avoids a blind window between the initial `GET` and the first event;
  the socket sends the current state (valid offers/requests) right on subscribing.
- **Coexistence with 0003:** if 0003 already added `app/infrastructure/realtime/`, **extend** that
  `connection_manager`/auth instead of duplicating them; the two sockets (negotiation and GPS) share the hub.
