# 0002 — Ride flow with offers/counter-offers between passenger and drivers (car/moto)

> **Status: ✅ Base delivery implemented** (verified on 2026-05-31).
> Offer negotiation and the driver's ride (`SEARCHING → … → COMPLETED`) are
> implemented in backend and mobile. What is **missing** is the **ride closing** (rating,
> history and real earnings); see **Part 2 — Extension: ride closing** at the end.
>
> File, route and account names below are historical (before email access was removed and the
> 2026-09 English renaming).

## Context

ViajaYa needs the product's core flow, which does not exist today: a **passenger** publishes a
request with an **offered price**; online **drivers** (car = `taxi`, moto = `moto`)
see the request and respond with **Accept** (at the passenger's price) or **Counter-offer** (their own
price + ETA); the **passenger reviews the offers received and picks one**, assigning the driver; the
ride advances through its lifecycle until completed. The app must **recognize the user's role** on
sign-in and show the **passenger or driver navigation** accordingly.

**Real state of the code (verified):**
- Backend `app/domain/entities.py` has `User` **without a role**, `ServiceType {taxi, moto}`,
  `PaymentMethod {qr, cash}`, `RideStatus` **only `searching`/`cancelled`** (the docstring literally says
  that "offer negotiation and the ride in progress arrive in a later delivery"),
  `RideRequest {rider_id, origin, destination, service_type, fare, payment_method, status}`.
  `UserRole`, driver, `Offer`, `OfferStatus`, `driver_id` **do not exist**.
- Alembic migrations: only `0001`→`0004` (users, ride_requests, payment_method, saved_places).
  There are **no** driver or offer tables.
- Repos: `RideRequestRepository` = `add`, `get_by_id`, `list_recent_destinations`. No offers.
- Mobile uses **Expo Router** (file-based) in `src/app/` with `(auth)` and `(app)/(tabs)` groups;
  session state in `src/store/authStore.ts` (Zustand); `User` in
  `src/features/auth/domain/types.ts` **without `role`**. Features: `auth`, `booking`, `home`
  (there is no `rides` feature). `OffersScreen.tsx` exists as a "searching for drivers" placeholder.
  Single HTTP in `src/core/http/client.ts` (axios `api` with 401 refresh). Currency: **Bs.**

**Decisions:** a **driver counter-offer** model (negotiation; the passenger chooses among the
offers). Real time with **polling** (React Query `refetchInterval`, MVP). Scope: user seed
+ role-based navigation + passenger and driver screens.

**UI guide (Stitch, project "App de Reserva de Taxis" `14684144038839565664`).** Reference
screens: Selección de Servicio y Oferta, Buscando Ofertas, Ofertas Disponibles, Panel de Control
Ofertas (driver), Detalle del Trayecto (driver), Seguimiento del Viaje, Finalización del Viaje,
Confirmación de Oferta Aceptada. The offers screen shows cards with driver, rating,
vehicle, ETA (`min`), price (`Bs.`), "Tu oferta: Bs. 25" and **Aceptar** / **Contraoferta** buttons.

---

## Target flow (state machine)

`RideStatus`: `SEARCHING → ACCEPTED → ARRIVING → IN_PROGRESS → COMPLETED` (+ `CANCELLED`).

1. The passenger creates a `RideRequest` (`service_type` car/moto, offered `fare`, payment) → `SEARCHING`.
2. **Online** drivers whose `vehicle_type` matches see the request. Each one creates an `Offer`
   (`PENDING`): **Accept** (`price = fare`) or **Counter-offer** (own `price` + `eta_min`).
3. The passenger sees the `PENDING` `Offer`s and **accepts one** → that offer `ACCEPTED`, the others `REJECTED`;
   `ride.driver_id`/`accepted_offer_id` set; ride → `ACCEPTED`.
4. The driver advances: `ACCEPTED → ARRIVING → IN_PROGRESS → COMPLETED`. Cancellation allowed before
   `IN_PROGRESS`.

---

## Backend (`backend/`, Clean Architecture)

### 1. Domain — `app/domain/entities.py`
- [x] `UserRole(StrEnum)`: `PASSENGER`, `DRIVER`, `DELIVERY`.
- [x] `User`: `role: UserRole`, and for drivers `vehicle_type: ServiceType | None`,
  `plate: str | None`, `vehicle_model: str | None`, `rating: float | None`, `is_online: bool = False`
  (+ `is_driver`, `is_social` props).
- [x] `RideStatus`: `ACCEPTED`, `ARRIVING`, `IN_PROGRESS`, `COMPLETED` (keeps `SEARCHING`/`CANCELLED`).
- [x] `RideRequest`: `driver_id: uuid.UUID | None = None`, `accepted_offer_id: uuid.UUID | None = None`.
- [x] `OfferStatus(StrEnum)`: `PENDING`, `ACCEPTED`, `REJECTED`, `EXPIRED`.
- [x] `Offer` (`@dataclass`): `ride_id`, `driver_id`, `price: Decimal`, `eta_min: int | None`,
  `status: OfferStatus = PENDING`, `id`, `created_at`.

### 2. Domain — `app/domain/repositories.py` and `app/domain/exceptions.py`
- [x] Extended `RideRequestRepository`: `update(ride)`, `list_open_for_service(service_type)`
  (status `SEARCHING`), `list_by_driver(driver_id)`, `list_recent_destinations(rider_id, limit)`.
- [x] `OfferRepository`: `add`, `get_by_id`, `update`, `list_by_ride(ride_id)`,
  `reject_others(ride_id, keep_offer_id)`.
- [x] `UserRepository`: `update` (used to toggle `is_online`).
- [x] Exceptions (inherit from `DomainError`): `RideNotFoundError`, `OfferNotFoundError`,
  `InvalidRideTransitionError`, `NotAuthorizedActionError`.

### 3. Application — use cases (one per file in `app/application/use_cases/`)
Pattern of `create_ride_request.py`; DTOs in `app/application/dto.py`.
- [x] `list_open_rides.py` (driver: open requests for their `vehicle_type`).
- [x] `create_offer.py` (driver: accept or counter-offer on a `SEARCHING` ride).
- [x] `list_offers_for_ride.py` (passenger: `PENDING` offers of their ride).
- [x] `accept_offer.py` (passenger: marks the offer `ACCEPTED`, assigns the driver, rejects the rest, ride→`ACCEPTED`).
- [x] `update_ride_status.py` (driver: valid transitions `ARRIVING/IN_PROGRESS/COMPLETED`).
- [x] `cancel_ride.py` (passenger/driver).
- [x] `set_driver_online.py` (driver: toggles `is_online`).
- [x] `get_ride.py` (status polling for both sides).
- [x] **(extra)** `get_driver_active_ride.py` (the driver's active ride: `ACCEPTED/ARRIVING/IN_PROGRESS`).
- [x] **(extra)** `list_recent_destinations.py` (the passenger's recent destinations).

### 4. Infrastructure — `app/infrastructure/db/`
- [x] `models.py`: extended `UserModel` (role + driver fields), `RideRequestModel`
  (`driver_id`, `accepted_offer_id`, new statuses), `OfferModel` (`offers` table).
- [x] `repositories.py`: new methods + `SqlAlchemyOfferRepository` (incl. `reject_others`).
- [x] **Migration** `migrations/versions/0005_drivers_and_offers.py`: role/driver columns in
  `users`, `driver_id`/`accepted_offer_id` in `ride_requests`, `offers` table.
- [x] **(extra)** Migration `0006_normalize_enum_values.py`: normalizes enum values to lowercase in the DB.

### 5. API — `app/api/v1/`
- [x] `schemas/`: `offers.py` (`OfferCreate {price, eta_min, accept_at_fare}`, `OfferResponse`),
  `rides.py` (`RideStatusUpdate`, `OpenRideResponse`, `RideResponse` with driver/status),
  `drivers.py` (`OnlineRequest`). `schemas/auth.py` exposes `role`/`vehicle_type`.
- [x] `routers/rides.py`: `GET /rides/open`, `GET /rides/{id}`, `GET /rides/{id}/offers`,
  `POST /rides/{id}/offers`, `POST /rides/offers/{offer_id}/accept`, `PATCH /rides/{id}/status`,
  `POST /rides/{id}/cancel`, `GET /rides/recent-destinations` (extra).
- [x] `routers/drivers.py`: `POST /drivers/me/online` (toggle) + `GET /drivers/me/active-ride`
  (extra). Everything protected with `CurrentUserDep`; validates role.
- [x] `api/deps.py`: `get_*` factories + `Annotated[...]` per use case and `OfferRepository`.
- [x] `api/errors.py`: new exceptions mapped to HTTP (404/403/409).

### 6. Seed — `backend/scripts/seed.py`
- [x] **Idempotent** async script (`AsyncSession`, `bcrypt_hasher`, `UserRepository`), common password
  `ViajaYa1234#`. Creates **2 per role** if they do not exist:
  - Passengers: `passenger1@viajaya.com`, `passenger2@viajaya.com`.
  - **Car** driver: `driver.auto1@viajaya.com`, `driver.auto2@viajaya.com` (`vehicle_type=taxi`).
  - **Moto** driver: `driver.moto1@viajaya.com`, `driver.moto2@viajaya.com` (`vehicle_type=moto`).
  Run with `python -m scripts.seed`.

### 7. Tests — `backend/tests/`
- [x] `unit/test_offer_use_cases.py` (with `tests/fakes.py`): `create_offer`, `accept_offer`
  (assigns the driver, rejects the rest), `update_ride_status` (valid/invalid transitions),
  `set_driver_online`, `list_open_rides`.
- [x] `e2e/test_offers_flow_api.py`: full flow — the passenger creates a ride → 2 drivers make offers
  (one accepts, the other counter-offers) → the passenger picks one → the driver advances to `COMPLETED`.

---

## Mobile (`mobile/`, Expo Router + features)

### 1. Role on the client
- [x] `src/features/auth/domain/types.ts`: `role` and `vehicleType` in `User`.
  Mapped in `src/features/auth/data/mappers.ts`.

### 2. Role-based navigation — `src/app/`
- [x] Group `src/app/(driver)/` with `(tabs)`: `index` (Driver Home),
  `solicitudes`, `ganancias`, `profile`, + `trayecto.tsx` (request detail).
- [x] `src/app/_layout.tsx` / `src/app/index.tsx`: destination by `authStore.user.role`
  → `(driver)` if driver, `(app)` if passenger.

### 3. `rides` feature (new) — data, domain and shared state
- [x] `src/features/rides/domain/types.ts`: `Offer`, `OfferStatus`, `OpenRide`, `Ride`, `RideStatus`.
- [x] `src/features/rides/data/ridesRepository.ts`: `getOpenRides`, `getRide`, `listOffers`,
  `createOffer`, `acceptOffer`, `updateStatus`, `cancel`, `setOnline`, `getActiveRide`
  (with DTO↔domain mappers over `api`).
- [x] `src/features/rides/application/`: React Query hooks with `refetchInterval`:
  `useOpenRides`, `useRideOffers`, `useRide` (polling), `useDriverActiveRide`, and the mutations
  `useCreateOffer`, `useAcceptOffer`, `useUpdateRideStatus`, `useCancelRide`, `useSetOnline`.

### 4. Passenger screens (extend `booking`, Stitch guide)
- [x] **Service Selection and Offer**: `ConfigureTripScreen.tsx` — car/moto selector, editable
  offered price (Bs.), payment method, "Buscar Ofertas" button.
- [x] **Searching Driver + Offers**: `OffersScreen.tsx` — polling of `GET /rides/{id}/offers`;
  cards with driver, rating, vehicle, ETA and price, **Accept** per offer; empty state
  "Buscando conductor…".
- [x] **Ride in Progress (Passenger)**: `src/app/(app)/booking/trip.tsx` + `TripScreen.tsx` with polling
  of the ride status and a cancel button.

### 5. Driver screens (new, `driver` feature, Stitch guide)
- [x] `InicioConductorScreen`: Online/Offline toggle (`POST /drivers/me/online`), summary.
- [x] `SolicitudesEntrantesScreen` (+ `RequestCard`, `SolicitudesMapa`, `CounterOfferModal`):
  list/map (polling) of `GET /rides/open`, **Accept** / **Counter-offer** actions (price + ETA modal).
- [x] `ViajeEnCursoConductorScreen` (+ `DetalleTrayectoScreen`): advances the status
  (`Llegué` → `Iniciar` → `Finalizar`) via `PATCH /rides/{id}/status`.
- [x] `PerfilConductorScreen`: vehicle data + logout.
- [x] `GananciasConductorScreen`: real data (`useDriverEarnings`) — delivered in **Part 2**.

### 6. Contract in sync
- [x] Backend schemas reflected in `features/rides/domain/types.ts` and methods in `data/`.
  Currency Bs. throughout the UI.

### Ride closing (delivered in Part 2)
- [x] Post-ride rating (passenger ↔ driver).
- [x] Ride history: `(app)/(tabs)/history.tsx` (passenger) and `(driver)/historial.tsx` (driver).
- [x] Real driver earnings.
- [x] Ride-in-progress views with a map (passenger tracking / driver navigation).
- [ ] *(out of scope)* Passenger wallet: `(app)/(tabs)/wallet.tsx` (still a placeholder).

---

## Implementation order

1. Backend: domain → repos/exceptions → use cases → models/migration `0005` → schemas/routers/deps/errors.
2. Backend: `scripts/seed.py` + `role`/`vehicle_type` in auth. Unit + e2e tests.
3. Mobile: role in `User` + role-based navigation (`(driver)` group).
4. Mobile: `rides` feature (repo + polling hooks) → passenger screens → driver screens.
5. Quality and rebuilding the app for review.

---

## Verification (end to end)

**Backend**
```bash
cd backend && source .venv/bin/activate
docker compose up -d db            # from the root
alembic upgrade head               # includes 0005
python -m scripts.seed             # creates test users
ruff check . && pytest             # lint + unit + e2e
uvicorn app.main:app --reload --port 8000   # smoke at /docs
```
Smoke in Swagger: log in `passenger1@viajaya.com` (`ViajaYa1234#`) → create a taxi ride; log in
`driver.auto1@...` → online → `GET /rides/open` → make an offer; passenger → `GET /rides/{id}/offers`
→ accept; driver → `PATCH /status` until `COMPLETED`.

**Mobile (rebuild for review)**
```bash
cd mobile
npx tsc --noEmit && npm run lint   # type-check + lint
npx expo start -c                  # rebuild with a clean cache
```
Test two sessions: passenger (creates an offer, receives counter-offers, picks one, sees the ride) and
car/moto driver (online, sees the request, accepts/counter-offers, gets chosen, completes the ride).

---

# Part 2 — Extension: ride closing (rating · history · earnings)

> **Status: ✅ Completed** (2026-05-31). Backend (67 green tests, migration `0007` applied) and
> mobile (`tsc` + `lint` clean). Delivered scope: **post-ride rating**, **ride
> history** and **real driver earnings**. The passenger wallet stays out.
>
> Implemented in mobile:
> - [x] **Ride-in-progress views with a map** (Stitch style): shared `TripRouteMap` (map + street
>   route). Passenger (`TripScreen`): tracking with the driver card (Message/Call/Share)
>   and an "on the way" (`accepted`) vs "arrived" (`arriving`) banner. Driver (`ViajeEnCursoConductorScreen`):
>   map + navigation banner + addresses + a button per status (Llegué→Iniciar→Finalizar);
>   `SolicitudesEntrantesScreen` mounts it full screen.
> - [x] Reusable `RideRatingCard` + `RatingScreen` + route `(app)/booking/rating.tsx`; `TripScreen`
>   (passenger) navigates to rating on `completed`; `ViajeEnCursoConductorScreen` (driver) shows the
>   card to rate the passenger on `completed`.
> - [x] Real history in `(app)/(tabs)/history.tsx` (Completed/Cancelled tabs) via
>   `RideHistoryScreen`; driver access in `(driver)/historial.tsx` (link from their profile).
> - [x] `GananciasConductorScreen` with `useDriverEarnings` (real data).

## Target flow (updated)

`COMPLETED` stops being a "dead" terminal: on completion, **each party rates the other**;
passenger and driver check their **history** and the driver sees their real **earnings**.

```
… IN_PROGRESS → COMPLETED → [Rating passenger ↔ driver] → History / Earnings
```

**Reference Stitch designs (project `14684144038839565664`):**
- *Viaje Finalizado - Pasajero*: "¡Has llegado a tu destino!", Cost/Distance/Duration cards,
  driver card (photo, vehicle, plate), **5-star rating**, optional comment,
  payment method, **Finalizar** button.
- *Finalización del Viaje* (driver): the same, rates the **passenger**, **Listo** and **Ver Recibo** buttons.
- *Historial de Viajes*: **Completados / Cancelados** tabs, cards with destination, date/time,
  vehicle, price (Bs.) and rating.

---

## Backend (`backend/`, Clean Architecture)

### 1. Domain — `app/domain/entities.py`
- `RideRating` (`@dataclass`): `id`, `ride_id`, `rater_id`, `ratee_id`, `score: int` (1–5),
  `comment: str | None`, `created_at`.

### 2. Domain — `repositories.py` and `exceptions.py`
- New `RatingRepository(ABC)`: `add(rating)`, `get_by_ride_and_rater(ride_id, rater_id)`,
  `list_by_ratee(ratee_id)`, `average_for(ratee_id) -> float | None`.
- Extend `RideRequestRepository`: `list_history(user_id, role, status)` — terminal rides
  (`COMPLETED`/`CANCELLED`) by `rider_id` (passenger) or `driver_id` (driver), desc order
  (pattern of `list_by_driver`).
- New exceptions (inherit from `DomainError`): `RideNotCompletedError`, `AlreadyRatedError`.

### 3. Application — use cases (one per file)
- `rate_ride.py`: validates a `COMPLETED` ride and that `current_user` is the `rider` or the `driver`; infers
  the direction (rider→rates driver; driver→rates rider); prevents double voting (`AlreadyRatedError`);
  persists the `RideRating`; **if the rated party is a driver, recalculates `User.rating`** =
  `RatingRepository.average_for(driver_id)` and `UserRepository.update`.
- `list_ride_history.py`: history by role, enriched for the cards (destination, date,
  vehicle/driver, agreed price, rating).
- `get_driver_earnings.py`: aggregates the driver's `COMPLETED` rides (price = `accepted_price`):
  `total_today`, `trips_today`, `total_all_time`, `trips_all_time`, a short list per ride.
  DTOs in `app/application/dto.py`.

### 4. Infrastructure — `app/infrastructure/db/`
- `models.py`: `RideRatingModel` (`ride_ratings` table): `id`, `ride_id` FK→`ride_requests` CASCADE,
  `rater_id`/`ratee_id` FK→`users`, `score` (Integer), `comment` (Text|null), `created_at`;
  **unique `(ride_id, rater_id)`** to prevent double voting.
- `repositories.py`: `SqlAlchemyRatingRepository` + `list_history` in `SqlAlchemyRideRequestRepository`.
- **Migration `migrations/versions/0007_ride_ratings.py`**: creates `ride_ratings` with its unique constraint.

### 5. API — `app/api/v1/`
- `schemas/ratings.py` (new): `RatingCreate {score, comment?}`, `RatingResponse`.
- `schemas/rides.py`: `RideHistoryItemResponse` (destination, date, vehicle/driver, price, rating, status).
- `schemas/drivers.py`: `DriverEarningsResponse` (totals + items).
- `routers/rides.py`: `POST /rides/{ride_id}/rating`, `GET /rides/history?status=`.
- `routers/drivers.py`: `GET /drivers/me/earnings`.
- `api/deps.py`: factories `get_rate_ride`, `get_list_ride_history`, `get_driver_earnings` +
  `RatingRepositoryDep`.
- `api/errors.py`: `RideNotCompletedError`→409, `AlreadyRatedError`→409.

### 6. Tests — `backend/tests/`
- `unit/test_rating_use_cases.py`: `rate_ride` (correct direction, recalculation of the driver's
  rating, rejection if not `COMPLETED`, double voting, unrelated third party) and `get_driver_earnings`.
- `e2e/` (extend `test_offers_flow_api.py` or a new `test_close_flow_api.py`): after `COMPLETED`,
  the passenger rates → `GET /drivers/me/earnings` reflects it → `GET /rides/history` lists it.

---

## Mobile (`mobile/`, `rides`/`driver` feature)

### 1. Contract — `features/rides/domain/types.ts` + `data/ridesRepository.ts`
- Types: `RatingInput {score, comment?}`, `RideHistoryItem`, `DriverEarnings`.
- Repo methods: `rateRide(rideId, input)`, `getHistory(status)`, `getEarnings()`.
- Hooks (`application/`): `useRideHistory(status)`, `useDriverEarnings()`, `useRateRide()`
  (invalidates `ride`, `ride-history`, `driver-earnings`).

### 2. Post-ride rating (*Viaje Finalizado* style)
- Reusable `RatingScreen` component (1–5 stars + comment + cost/distance/payment-method
  summary + counterpart card), parameterized by role.
- **Passenger**: route `src/app/(app)/booking/rating.tsx`; on detecting `status === 'completed'` in
  `TripScreen.tsx`, redirect here; "Finalizar" → goes back home.
- **Driver**: after `Finalizar` (status→`completed`) in `ViajeEnCursoConductorScreen.tsx` /
  `(driver)/trayecto.tsx`, show `RatingScreen` rating the **passenger** + "Ver Recibo"
  (ride summary; no extra backend).

### 3. History (*Historial de Viajes* style)
- **Passenger**: implement `src/app/(app)/(tabs)/history.tsx` with **Completados/Cancelados** tabs,
  a `FlatList` of cards (destination, date, vehicle, price Bs., rating) via `useRideHistory`.
- **Driver**: access to history (tab or from the profile) reusing the same list, per role.

### 4. Real earnings — `features/driver/presentation/GananciasConductorScreen.tsx`
- Replace the placeholder with `useDriverEarnings`: today's total, number of rides, all-time total and
  a short list of recent rides with amount.

### 5. Contract in sync
- Each new backend schema is reflected in `features/rides` and its `data/` method. Currency **Bs.**

### Stitch screens → files map

| Stitch screen | Mobile file |
|---|---|
| Viaje Finalizado - Pasajero | `(app)/booking/rating.tsx` + `RatingScreen` |
| Finalización del Viaje (driver) | `RatingScreen` (driver role) from `(driver)/trayecto.tsx` |
| Historial de Viajes | `(app)/(tabs)/history.tsx` + shared list |
| Seguimiento / En Camino / Navegación | already implemented (`TripScreen`, `ViajeEnCursoConductorScreen`) — visual reference |

---

## Implementation order (Part 2)

1. Backend: domain → repos/exceptions → use cases → `RideRatingModel`/migration `0007` →
   schemas/routers/deps/errors. Unit + e2e tests.
2. Mobile: types + repo + hooks → `RatingScreen` and completion wiring → history → earnings.
3. Quality (`ruff`/`pytest`; `tsc`/`lint`) and rebuilding for review.

## Verification (Part 2)

**Backend**
```bash
cd backend && source .venv/bin/activate
alembic upgrade head          # includes 0007
ruff check . && pytest        # unit + e2e (ride closing)
```
Smoke in Swagger: complete a ride → `POST /rides/{id}/rating` (passenger) → the driver's `rating`
changes → `GET /drivers/me/earnings` adds it → `GET /rides/history?status=completed` lists it.

**Mobile**
```bash
cd mobile && npx tsc --noEmit && npm run lint && npx expo start -c
```
Two sessions: the passenger completes a ride → rates → sees history; the driver finishes → rates the
passenger → sees earnings and history.
