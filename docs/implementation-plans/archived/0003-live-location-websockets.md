# 0003 — Live driver location (WebSocket) at low cost

> **Status: ⏳ Pending.** Depends on delivery 0002 (full ride flow, already implemented:
> offers, ride in progress with map, rating, history, earnings).
>
> File and component names below are historical (before the 2026-09 English renaming).

## Context

Today ViajaYa's "real time" is **polling** (React Query `refetchInterval`): ride status,
offers and history refresh every 3–4 s (`useRide`, `useRideOffers`, `useOpenRides`). The
ride-in-progress views (`TripScreen` passenger, `ViajeEnCursoConductorScreen` driver) draw the
origin→destination path with `TripRouteMap`, but **do not show the driver's real position**.

We want the passenger to see the driver moving on the map **in real time**, over **WebSocket**,
without costs spiking.

**Architecture decisions (key for cost):**
- **Mixed transport:** WebSocket **only** for the driver's GPS (the only thing that needs to be
  instant). Everything else (ride status, offers, history, earnings) **stays on polling** — simpler
  and it already works.
- **Flat-rate hosting:** an always-on `uvicorn` process (VPS/fixed container). FastAPI's native
  WebSockets cost nothing per message or connection in this model. **Avoid
  per-request serverless** for the socket (it charges per connection-minute/message).
- **Last value in memory:** each position is not persisted in Postgres (only the last one matters). An
  in-process memory store; **Redis pub/sub is deferred** until there are several processes (see §Scaling).
- **Google Maps discipline (the real cost):** the raw position travels for free over the socket and moves the
  marker; the **route/ETA is recomputed at most every ~20–30 s** (or on a detour), not on every tick.

---

## Target flow

```
Driver (active ride) --GPS every ~2–3 s--> WS /ws/rides/{id} --broadcast--> Passenger (animated marker)
```

1. When the driver is assigned (`ACCEPTED`), both open the ride socket.
2. The **driver** emits their position (`expo-location` watcher) while the ride is
   `ACCEPTED/ARRIVING/IN_PROGRESS`.
3. The backend stores the **last position** and **forwards** it to the ride's subscribers (the passenger).
4. The **passenger** moves an animated marker on the map; the banner ETA is recomputed
   sparingly from the driver's position.
5. On `COMPLETED`/`CANCELLED` the socket is closed and the position is cleared.

---

## Backend (`backend/`, Clean Architecture)

### 1. Domain — `app/domain/entities.py`
- Value object `DriverLocation` (`@dataclass(frozen=True)`): `latitude`, `longitude`,
  `heading: float | None`, `updated_at: datetime`.

### 2. Application — ports and use cases
- `app/application/interfaces.py`: `DriverLocationStore` port
  - `set(ride_id, location)`, `get(ride_id) -> DriverLocation | None`, `clear(ride_id)`.
- `app/application/use_cases/update_driver_location.py`: validates that `current_user` is the ride's
  **assigned driver** and that the status is in `{ACCEPTED, ARRIVING, IN_PROGRESS}`
  (reuses `RideRequestRepository.get_by_id` and the exceptions `NotAuthorizedActionError`,
  `InvalidRideTransitionError`); stores it and returns the `DriverLocation` to broadcast.
- (Read) reuse `get_ride`/store to get the last value.

### 3. Infrastructure
- `app/infrastructure/realtime/location_store.py`: `InMemoryDriverLocationStore` (dict
  `ride_id -> DriverLocation`, with TTL/cleanup when the ride closes).
- `app/infrastructure/realtime/connection_manager.py`: `RideConnectionManager` that keeps
  `ride_id -> set[WebSocket]` of **subscribers** (passengers) and exposes `connect/disconnect/broadcast`.
  Handles disconnection and cleans up empty sets.

### 4. API — WebSocket endpoint
- `app/api/v1/ws/rides.py`: `@router.websocket("/ws/rides/{ride_id}")`.
  - **Socket auth:** access token via **query param** `?token=<access_token>` (RN does not allow
    headers on `WebSocket`); validate with `JwtTokenService.decode_access_token` and load the user.
    Close with a policy code if the token is invalid (`1008`). Use **`wss://` in production**
    so the token travels encrypted; the access token is short-lived (mitigates leaks in logs/URL).
    (Later superseded: the token now travels in the `viajaya.auth` subprotocol, never in the URL.)
  - **Authorization:** the user must be the ride's `rider_id` or `driver_id`; otherwise, close.
  - **Driver role:** receives JSON messages `{lat, lng, heading?}`; for each one it runs
    `update_driver_location` and does a `broadcast` to the ride's subscribers.
  - **Passenger role:** on connect, **immediately send** the last value (`store.get`) and then stay
    subscribed to the broadcasts.
  - Close/cleanup on disconnect or when a terminal state is detected.
  - Injection: reuse the `deps.py` factories (token service, repos) creating one session per
    connection; register the router in `app/main.py`.
- **Polling fallback (resilience):** add `driver_location` (nullable) to `RideResponse`
  (`schemas/rides.py`) reading from the store in `get_ride`. This way, if the socket drops, the passenger still
  sees the last position via the existing `GET /rides/{id}` polling.

### 5. Tests — `backend/tests/`
- `unit/`: `update_driver_location` (rejects a non-driver, rejects an inactive ride, stores and
  returns). `InMemoryDriverLocationStore` (set/get/clear).
- `e2e/`: `TestClient.websocket_connect` (Starlette) — the driver publishes, the passenger receives; an
  invalid token closes; a user outside the ride is closed. Verify `driver_location` in `GET /rides/{id}`.

---

## Mobile (`mobile/`, Expo Router + `rides` feature)

### 1. Configuration — WebSocket URL
- In `core/config/env.ts`/`app.config.ts`: derive `wsUrl` from `apiUrl` (`http→ws`, `https→wss`) or
  expose it separately. Do not read `process.env` directly (`CLAUDE.md` rule).

### 2. WS client — `core/realtime/`
- `rideSocket.ts`: a utility that opens `new WebSocket(`${wsUrl}/ws/rides/${id}?token=${accessToken}`)`,
  with **backoff reconnection**, JSON parsing, and a `send(location)` / `onMessage(cb)` / `close()` API.
  Take the token from `core/http/tokenStorage`.

### 3. Driver — emit GPS
- Hook `features/rides/application/useReportLocation.ts`: with `expo-location`
  `watchPositionAsync({ accuracy: High, distanceInterval: 30, timeInterval: 3000 })` **only** while
  the ride is active; sends each reading over the socket. Permissions already declared in `app.config.ts`.
  Start/stop according to `ride.status` in `ViajeEnCursoConductorScreen`. (Background with
  `expo-task-manager` is **out of scope**; MVP in foreground.)

### 4. Passenger — consume and draw
- Hook `features/rides/application/useDriverLocation.ts`: subscribes to the ride socket and exposes the
  last `{lat,lng,heading}`; **fallback** to `ride.driverLocation` (from polling) when the socket is
  down.
- `TripRouteMap`: add an **animated driver marker** (`MarkerAnimated` + `AnimatedRegion`
  interpolating ~1 s between positions, `rotation={heading}`, car/moto icon). Include it in the
  `fitToCoordinates` together with the relevant point (origin if `accepted/arriving`, destination if `in_progress`).
- **ETA with cost discipline:** recompute the route from the driver's position with
  `routesService`/`useRoute` **at most every 20–30 s** (throttle) or on a detour; in between, only
  move the marker (free). Show the ETA in the navigation banner.

### 5. Contract in sync
- `Ride.driverLocation` in `features/rides/domain/types.ts` + mapper in `data/ridesRepository.ts`.

---

## Cost control (operational summary)

- **Flat compute:** an always-on `uvicorn` (~5–12 USD/month); the socket adds no per-message
  cost. Do not use per-request serverless for the WS.
- **Only during an active ride:** open the socket on `ACCEPTED`, close it on `COMPLETED`/`CANCELLED`.
- **Moderate frequency:** GPS every 2–3 s or every 30 m; interpolate on the client so it looks smooth.
- **Bounded Maps:** do NOT recompute route/ETA per tick → every 20–30 s or on a detour. It is the biggest saving.
- **Last value in memory** (without writing each position to the DB).

---

## Scaling (when and what to pay more for)

1. **Now:** 1 FastAPI process + in-memory store/manager. Cost = the VPS, flat.
2. **Several processes/instances:** add **Redis pub/sub** (small Redis ~5–10 USD/month) so the
   broadcast reaches the process holding the passenger's socket; the manager publishes/listens on Redis.
3. **Not operating infra:** managed services (Ably/Pusher/Supabase Realtime) with a free tier; convenient
   but their cost grows with connections/messages. Postpone until volume justifies it.

---

## Implementation order

1. Backend: `DriverLocation` + `DriverLocationStore` (memory) + `update_driver_location` +
   `RideConnectionManager` + `ws` endpoint + `driver_location` in `RideResponse`. Unit/e2e tests.
2. Mobile: `wsUrl` in config + `rideSocket` client (reconnection).
3. Mobile driver: `useReportLocation` (expo-location → socket), wired into the ride in progress.
4. Mobile passenger: `useDriverLocation` + animated marker in `TripRouteMap` + throttled ETA.
5. Quality (`ruff`/`pytest`; `tsc`/`lint`) and a test with two devices.

---

## Verification (end to end)

- **Two sessions** (passenger + driver) in an active ride: the driver's marker moves smoothly
  on the passenger's map; the ETA banner updates sparingly.
- **Resilience:** cut the passenger's network → on reconnect the socket resumes; with the socket down, the
  last position stays visible via the `GET /rides/{id}` polling (`driver_location`).
- **Authorization:** a user outside the ride cannot connect; an invalid token closes the socket.
- **Cost:** count the Google Routes calls in a test ride and confirm the ETA is
  recomputed every ~20–30 s (not for each position).

---

## Risks / open decisions

- **Token in the WS URL:** acceptable with `wss://` (encrypted) and a short-lived access token; avoid
  logging the query. Future alternative: an auth handshake as the socket's first message.
- **Background location:** out of scope (MVP foreground only); if required, `expo-task-manager`.
- **A single process:** the in-memory store/manager assumes 1 worker; when scaling, Redis pub/sub (§Scaling).
- **Device battery/data:** mitigated with adaptive frequency and a socket only during an active ride.
