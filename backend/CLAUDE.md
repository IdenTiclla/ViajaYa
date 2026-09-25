# ViajaYa — Backend (FastAPI + Clean Architecture)

Taxi and parcel API. Python 3.11+, async FastAPI, async SQLAlchemy 2.0 on
PostgreSQL, phone + OTP access (with optional Google/Facebook linked to a
verified phone), JWT managed sessions and real time over WebSocket.

## Architecture (Clean Architecture)

Dependencies always point **inward**: `api → application → domain`.
Infrastructure implements domain/application interfaces and is wired in `api/deps.py`.

```
app/
├── domain/                  # Core. NO framework dependencies.
│   ├── entities.py            # User, RideRequest, Offer, RideRating, SavedPlace + enums
│   │                          #   (AuthProvider, UserRole, VehicleType, ServiceType, DriverStatus,
│   │                          #    PaymentMethod, RideStatus, OfferStatus, SavedPlaceCategory)
│   ├── value_objects.py       # Email, GeoPoint, FareOffer (frozen, slots)
│   ├── repositories.py        # Interfaces (ports): User, RideRequest, Offer, Rating, SavedPlace
│   ├── ride_policy.py         # OFFER_TTL=30s + offer_expires_at / is_offer_expired / is_offer_active
│   └── exceptions.py          # DomainError + 18 specific exceptions
├── application/             # Use cases. They orchestrate the domain.
│   ├── use_cases/             # ONE use case per file (list below)
│   ├── interfaces.py          # Technical ports and application read projections
│   ├── dto.py                 # @dataclass(frozen=True) input/output between layers
├── infrastructure/          # Concrete adapters.
│   ├── config.py              # Settings (pydantic-settings). SINGLE source of truth for config.
│   ├── db/                    # SQLAlchemy: models, repos, UnitOfWork and durable outbox
│   ├── security/              # jwt_service, phone_verification (HMAC of receipts)
│   ├── oauth/                 # google_verifier, facebook_verifier
│   └── realtime/              # local hub, dispatcher and transport coordination
└── api/                     # HTTP layer (FastAPI).
    ├── deps.py                # Injection: the ONLY infra→app wiring (get_* factories, *Dep)
    ├── errors.py              # DomainError → HTTP (_STATUS_MAP, no scattered HTTPException)
    ├── health.py              # Liveness, readiness and sanitized outbox snapshot
    └── v1/
        ├── routers/            # auth, rides, drivers, saved_places
        ├── schemas/            # Pydantic v2 request/response (do NOT reuse entities)
        ├── events.py           # WS publishers (RIDE_CREATED, OFFER_EXPIRED, …) via hub
        ├── presence.py         # Passenger presence with grace window (120 s)
        └── ws/negotiation.py   # WebSocket endpoints (/ws/driver, /ws/rides/{ride_id})
```

### Rules when adding code

- **The domain imports nothing from `application`, `infrastructure` or `api`.** If an entity
  needs an external service, define it as an interface (port) and receive the implementation by injection.
- **One use case per file** in `application/use_cases/`, with an **`async def execute(...)`** method
  (not `__call__`). A `get_*` factory in `api/deps.py` returns the wired instance.
- **All object construction lives in `api/deps.py`.** Exposed as `Annotated[T, Depends(...)]`
  (`CurrentUserDep`, `SessionDep`, `*RepositoryDep`). Do not instantiate repos/services in routers.
- **Routers only translate HTTP↔use case.** They receive Pydantic schemas, call the injected UC,
  return a `response_model` and publish events via `app.api.v1.events`. No business logic.
- **Schemas (`api/v1/schemas/`) ≠ entities.** Never expose domain entities directly;
  use `XResponse.from_detail(...)` helpers.
- **Errors:** raise `DomainError` from UCs; it is mapped to HTTP in `api/errors.py`. The only exception:
  `unauthorized()` for auth. Never a scattered `HTTPException`.
- **Offer policy** (TTL, expiry) lives in `domain/ride_policy.py`, not in UCs or entities.
- **Enriched reads:** `RideReadRepository` avoids exposing the ORM and N+1 loads.
  Earnings uses a SQL aggregate for totals/counts and another query limited to
  the last 10 rides; application bounds the day in `America/La_Paz`.
- **Transactions migrated to the outbox:** the repository does `flush`, the use
  case records the batch and `UnitOfWork` decides the single `commit`. Do not convert
  other repositories mechanically: migrate all call sites of an operation
  in the same change. `CreateOffer`, `AcceptOffer`, `PauseRideForEdit`,
  `CancelRide`, `CancelRideOnDisconnect`, `UpdateRideFare`, `EditRide`,
  `AnnounceOpenRide`, `WithdrawOffer`, `RejectOffer`, `ExpireOffer` and
  `UpdateRideStatus`, plus `SetDriverOnline` in both directions, already use
  this flow;
  `CreateRideRequest` delegates the commit to the UoW, but does not announce until
  presence is confirmed.

### Pattern for adding an endpoint

1. Entity/value object in `domain/` (if applicable).
2. Method in the abstract repository + `SqlAlchemy*` implementation in `infrastructure/db/`.
3. UC `async def execute` in `application/use_cases/`.
4. DTO in `application/dto.py` (if there is composite input/output data).
5. Pydantic schema in `api/v1/schemas/`.
6. `get_*` factory in `api/deps.py`.
7. Endpoint in `api/v1/routers/` that translates HTTP↔UC and publishes events via `app.api.v1.events`.
8. Alembic migration if it touches the schema.
9. Unit test (UC with doubles) and/or e2e (API).

## Commands

```bash
cd backend
source .venv/bin/activate         # virtual environment (or use uv; see the note in the monorepo README)

# Start PostgreSQL + Redis (from the repo root)
docker compose up -d db redis

# Migrations (Alembic)
alembic upgrade head              # apply
alembic revision -m "message"     # new migration (REVIEW THE AUTOGENERATED ONE BY HAND)

# Development server
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
# Swagger: http://localhost:8000/docs   ·   Health: GET /health

# Tests (no coverage configuration yet)
pytest                            # everything
pytest tests/unit                 # unit only (UC with fakes)
pytest tests/e2e                  # end-to-end API (httpx + aiosqlite)
pytest tests/e2e/test_negotiation_ws.py   # WS negotiation flow

# Quality
ruff check .                      # lint (E,F,I,UP,B,C4 · line-length=100)
ruff check --fix . && ruff format .
```

## Configuration

`infrastructure/config.py` (`Settings`) reads from `.env` (see `.env.example`). Key variables:

```
DATABASE_URL=postgresql+asyncpg://viajaya:viajaya@localhost:5432/viajaya
JWT_SECRET, JWT_ALGORITHM (HS256),
ACCESS_TOKEN_EXPIRE_MINUTES (30), REFRESH_TOKEN_EXPIRE_DAYS (14),
CORS_ORIGINS (comma-separated list; helper .cors_origins_list),
GOOGLE_CLIENT_ID, FACEBOOK_APP_ID, FACEBOOK_APP_SECRET,
DRIVER_AUTO_APPROVE (false; approves driver sign-ups instantly, only outside production),
OPENMETRICS_ENABLED (false by default; publishes `/metrics` only on opt-in),
REALTIME_OUTBOX_DISPATCH_MODE (off|shadow|live_local|live_redis; off by default),
REALTIME_OUTBOX_RECORDING_ENABLED (false by default),
REALTIME_OUTBOX_POLL_INTERVAL_SECONDS (1),
REALTIME_OUTBOX_RETRY_BASE_SECONDS (1),
REALTIME_OUTBOX_RETRY_MAX_SECONDS (60),
REALTIME_OUTBOX_SHUTDOWN_TIMEOUT_SECONDS (5),
REALTIME_OUTBOX_PUBLISHED_RETENTION_DAYS (0, disabled),
REALTIME_OUTBOX_RETENTION_INTERVAL_SECONDS (3600),
REALTIME_OUTBOX_RETENTION_BATCH_LIMIT (100),
REALTIME_REDIS_URL (redis://localhost:6379/0),
REALTIME_REDIS_CHANNEL (viajaya:realtime:v2),
REALTIME_REDIS_CONNECT_TIMEOUT_SECONDS (2),
REALTIME_REDIS_RECONNECT_BASE_SECONDS (0.5),
REALTIME_REDIS_RECONNECT_MAX_SECONDS (30),
REALTIME_SHARED_PRESENCE_ENABLED (false),
REALTIME_PRESENCE_KEY_PREFIX (viajaya:presence:v1),
REALTIME_PRESENCE_LEASE_SECONDS (30),
REALTIME_PRESENCE_RENEW_INTERVAL_SECONDS (10),
REALTIME_PRESENCE_GRACE_SECONDS (120),
REALTIME_PRESENCE_RECHECK_SECONDS (5),
SCHEDULED_ACTIONS_MODE (off|shadow|live; off by default),
SCHEDULED_ACTIONS_POLL_INTERVAL_SECONDS (1),
SCHEDULED_ACTIONS_LEASE_SECONDS (30),
SCHEDULED_ACTIONS_HANDLER_TIMEOUT_SECONDS (10),
SCHEDULED_ACTIONS_MAX_ATTEMPTS (5),
SCHEDULED_ACTIONS_RETRY_BASE_SECONDS (1),
SCHEDULED_ACTIONS_RETRY_MAX_SECONDS (60),
SCHEDULED_ACTIONS_SHUTDOWN_TIMEOUT_SECONDS (12),
SCHEDULED_ACTIONS_TERMINAL_RETENTION_DAYS (30),
SCHEDULED_ACTIONS_RETENTION_INTERVAL_SECONDS (60),
SCHEDULED_ACTIONS_RETENTION_BATCH_LIMIT (1000)
```

Access config with `get_settings()` (cached with `@lru_cache`); **do not read `os.environ` directly**.
CORS is applied in `main.py` with `cors_origins_list`.

The outbox rollout must follow this sequence: `off+false` ->
`shadow+false` -> `shadow+true` -> `live_local+true` -> `live_redis+true`. Do not
use `off+true` or enable a live mode without draining and reviewing the shadow
backlog first. Before leaving
`off`, `0018_realtime_outbox`,
`0019_realtime_stream_versions`, `0020_realtime_outbox_quarantine` and
`0021_realtime_outbox_batch_size` must be applied. `shadow`
claims, validates and marks batches, but does not deliver them. `live_local` pre-serializes
the whole batch as v2 envelopes, sends it in order to the process hub and only
then marks `published_at`; at the same time it disables the legacy direct delivery
and uses the unified v2 snapshots. A live quarantine closes the sockets of its
streams with 1012 after the commit to force another snapshot.

`live_local` is exclusively a **single API worker** canary vertical.
`live_redis` publishes the whole v2 batch to Redis and each process keeps a
subscriber that delivers it only to its local sockets. Pub/Sub is ephemeral: losing
the subscription closes all local sockets with 1012 so the new
handshake recovers snapshot and watermarks from PostgreSQL. While Redis is not
healthy, local timers postpone the absence cancellation. A publish without
any subscriber fails and keeps the batch for retry; a batch that exceeds the
byte limit is set aside with `transport_limit` and forces a snapshot instead of
being retried forever. The advisory locks keep the legacy key during a
rolling deploy: several `shadow` can coexist, `live_local` is always
exclusive and `live_redis` only shares the lock when
`REALTIME_SHARED_PRESENCE_ENABLED=true`. The flag requires a `live` scheduler; when off,
the second process keeps failing. Promotion happens after deploying the
binary with the flag off on all replicas. Losing the owning session
stops the dispatcher. SQLite skips this exclusion only in tests. Another smoke stops a dedicated Redis
between commit and publish, requires a 1012 close and certifies the replay of the same
durable identity after the restart.

During the `0023` rollout, the new bridge subscribes both to
`REALTIME_REDIS_CHANNEL` and to its derived `:correlation-v1` channel. It publishes
first the correlated copy with `wire_version=2` and then a
`wire_version=1` copy without the new field on the original channel. Old replicas
only receive the second one; new ones skip the legacy copy if they already observed the
correlated batch. If Redis inverts the order, the mobile gate accepts the
duplicate because diagnostic correlation does not alter the event identity.
They also accept earlier producers using `batch_id` as a stable
correlation. Do not remove this dual publication while an older
replica may still be active.

Migration `0022_scheduled_actions` must be applied before deploying the code
that creates offers. The `expire_offer` action is persisted in all three modes. `off`
keeps the local timer without consuming the queue; `shadow` runs both the
durable worker and the timer, keeping legacy delivery for whoever wins the
race; `live` removes the timer and depends on the
`live_local|live_redis` outbox. This way,
restarts and mode changes neither leave offers without recovery nor build up a
backlog before the cutover. Startup and each consumer cycle reconcile in
batches any offer the previous version created after the migration's
backfill. Deadlines, leases, backoff and the atomic revalidation on accept
use the PostgreSQL clock.
`succeeded/cancelled` actions are purged in batches after 30 days;
`dead` actions are kept for manual intervention.

Shared presence uses a Redis sorted set per ride with separate members
`ws:{connection_id}`/`http`; Lua prunes and evaluates leases with `Redis TIME` without
one disconnection deleting another connection. Each renewal does a generational upsert of
`cancel_absent_ride`; ride creation already persists its first generation in
the same UoW. Startup and each cycle reconcile legacy searches by giving them a
full grace from the reconciliation. The worker takes PostgreSQL fencing, queries Redis and only
cancels `SEARCHING && !paused` when neither lease nor grace remains. Redis down or
just recovered postpones the action without exhausting its retries.

Every HTTP request accepts `X-Request-ID` only if it is a valid UUID; otherwise
it generates one and always returns it in the response. The middleware
logs the canonical route, result, duration and `correlation_id`, never query,
headers or payload. Migration `0023_outbox_correlation_id` persists that UUID
in each durable event and delivers it in the v2 envelope; scheduler effects
use their action ID as a stable correlation after a restart. The
PostgreSQL trigger assigns `batch_id` to rows from earlier producers, so
all events of their fanout share one correlation during the
rolling deploy.

`GET /health` and `GET /health/live` are dependency-free liveness. `GET
/health/ready` checks PostgreSQL, Redis when applicable and that enabled
workers are still active. `GET /health/realtime` exposes only sanitized aggregates of
pending items, retries, quarantines, age and the conservative
`created_at → published_at` delay; it never includes topics or payloads.
`GET /metrics` exposes the same slice in OpenMetrics 1.0 only when
`OPENMETRICS_ENABLED=true`; the deployment must restrict it to the
monitoring network. Versioned rules and the runbook live in
`ops/monitoring/prometheus/`. The Compose `monitoring` profile wires the scrape and a
local Alertmanager without external destinations; staging/production must mount the
secret-managed configuration and apply their perimeter control.

Published-row retention is opt-in (`...RETENTION_DAYS=0` by default) and
works on whole batches, with one transaction and a bounded chunk per
interval. It does not delete
quarantines or aggregate/stream counters. Before enabling it, observe
the environment backlog and choose the TTL; `30` days is only an operational example,
not a default value.

## API (v1, prefix `/api/v1`)

- **auth** (`/auth`): **there is no email/password access** (removed on 2026-09-13;
  `/register`, `/login`, `/oauth/{provider}` and `/phone/link-legacy` return 404 and
  migration `0026` removed `hashed_password`/`legacy_auth_disabled`). Every token must
  belong to a managed session; a JWT without `session_id` gets 401 on HTTP, WS and refresh.
  - Session: `POST /refresh` (rotation + reuse detection), `GET /me`, `GET /sessions`,
    `POST /logout`, `POST /phone/change`.
  - Phone (`PHONE_OTP_ENABLED`; simulated with `test_code` outside production):
    `GET /phone/capabilities` (countries, terms and configured `social_providers`),
    `POST /phone/challenges`, `POST /phone/verify`, `POST /phone/complete`
    (`profile_required` → repeat with `full_name` + `terms_version`).
  - Social: `POST /social/{provider}/sign-in` (`phone_required` if the identity is not
    linked) and `POST /phone/link-social` (OTP + provider token in one transaction).
  - Recovery: `POST /recovery`, `POST /recovery/complete` (operator review in F03-B).
  See `docs/implementation-plans/0010-phone-identity-and-otp.md`.
- **rides** (`/rides`):
  - `POST ""` (create request), `GET /recent-destinations`, `GET /history`, `GET /{id}`.
    `GET /history` paginates with an opaque cursor and returns `{items, next_cursor}`.
  - `GET /open` (driver: `SEARCHING` requests for their offered services, **filtered by presence**),
    paginated with the same `{items, next_cursor}` shape.
  - `GET /{id}/offers`, `POST /{id}/offers` (driver creates an offer: `accept_at_fare=True` uses the fare, or a counter-offer with `price`+`eta_min`).
  - `POST /offers/{offer_id}/accept` (passenger: **atomic direct** assignment), `/reject`, `/withdraw`.
  - `PATCH /{id}/status` (driver: `ACCEPTED→ARRIVING→IN_PROGRESS→COMPLETED`).
  - `PATCH /{id}/fare` (passenger: raise the offer while searching), `POST /{id}/pause-edit` + `PATCH /{id}` (edit request), `POST /{id}/cancel`, `POST /{id}/rating`.
- **drivers** (`/drivers`): `GET /me/vehicles`, `POST /me/vehicles` (create/edit the vehicle
  of that type: `vehicle_type`, `plate`, `vehicle_model`, `services`; returns `{user, vehicle}`),
  `DELETE /me/vehicles/{vehicle_type}`, `POST /me/mode` (`{mode: passenger|driver,
  vehicle_type?}` switches the active mode and picks the vehicle to drive with),
  `POST /me/online`, `GET /me/active-ride`, `GET /me/earnings`.
- **saved-places** (`/saved-places`): `GET ""`, `POST ""`, `PUT /{place_id}`, `DELETE /{place_id}`.

Protected routes use `CurrentUserDep` (header `Authorization: Bearer <access_token>`).

### Use cases

Access: `request_phone_code`, `verify_phone_code`, `complete_phone_sign_in`,
`sign_in_with_social`, `refresh_managed_session`, `manage_account_sessions`,
`change_account_phone`, `request_account_recovery`, `review_account_recovery`,
`complete_account_recovery`. Rides: `create_ride_request`, `announce_open_ride`, `list_recent_destinations`, `list_open_rides`, `dismiss_open_ride`,
`get_ride`, `get_passenger_active_ride`, `get_pending_rating_ride`, `list_ride_history`,
`create_offer`, `list_offers_for_ride`, `accept_offer`, `reject_offer`,
`withdraw_offer`, `expire_offer`, `update_ride_status`, `update_ride_fare`, `cancel_ride`,
`cancel_ride_on_disconnect`, `pause_ride_for_edit`, `edit_ride`,
`rate_ride`, `skip_ride_rating`, `register_driver_vehicle`, `list_driver_vehicles`,
`remove_driver_vehicle`, `switch_account_mode`, `set_driver_online`,
`get_driver_active_ride`,
`get_driver_earnings`, `list_saved_places`, `create_saved_place`, `update_saved_place`,
`delete_saved_place`.

Outbox operations: `get_realtime_outbox_operational_snapshot` and
`purge_published_realtime_outbox`.

## Negotiation model (the passenger decides)

The passenger creates a `RideRequest` (`SEARCHING`). `VehicleType` represents only the physical
vehicle (`taxi`/`moto`/`truck`) and `ServiceType` the service (`taxi`/`moto`/`delivery`/`moving`).
`services_for_vehicle` says what each vehicle **can** offer (taxi→taxi+delivery,
moto→moto+delivery, truck→moving) and each driver **chooses** a subset at sign-up
(`User.driver_services`; empty = all of the vehicle's, for drivers created before 0027).
`User.offered_services` / `driver_can_serve` are the single source of truth for the pool
(`/rides/open`, `pool:{service}` topics, snapshots) and for making offers. Compatible
drivers make offers (`Offer` `PENDING`). **The passenger decides**: `POST /offers/{id}/accept` =
**direct assignment** — `OfferRepository.accept_atomically` uses `SELECT … FOR UPDATE` in
Postgres: it sets `driver_id`/`accepted_offer_id`, rejects the ride's other offers and withdraws the
chosen driver's live offers on **other rides** (`OfferAcceptance.withdrawn_offers` /
`losing_driver_ids`). **Golden rule**: if the driver was already assigned to another ride →
`DriverUnavailableError` (HTTP 409).

- **Request version:** `POST /rides/{id}/offers` accepts an optional `expected_pool_version`
  (new clients send it). If the passenger changed the request, it returns
  409 before creating/replacing the offer. The repository revalidates under lock the
  version read by the use case, also for older clients. No migration.
- **Improve offer** (same driver, same ride): **replaces** the previous one → emits
  `offer_withdrawn {reason:"superseded"}` + `offer_created` (there is NO dedicated `offer_superseded` event).
- **Editing the request does NOT cancel it** (orthogonal to status): `POST /{id}/pause-edit` hides the
  request from the pool and emits **three** things: `RIDE_CLOSED` to the pool, `RIDE_PAUSED` (full ride
  payload) to each driver with a live offer, and `OFFER_WITHDRAWN` to the passenger. `PATCH /{id}` edits
  origin/destination/service/fare/payment and republishes it. Flag `RideRequest.paused`.
- **Raise offer**: `PATCH /{id}/fare` raises the fare (only in `SEARCHING`) and re-announces to the pool
  (`ride_created` with the new amount).
- **Expiry**: the offer expires after 30 s (`OFFER_TTL` in `domain/ride_policy.py`); the request
  does not expire while the passenger is still present, but it is cancelled if both WS and HTTP heartbeat
  disappear during the grace period. Creation persists `expire_offer` in its same transaction.
  In `off` the local timer remains the active path; in `shadow` it competes
  idempotently with the durable worker and legacy publication is kept; in
  `live` only the worker runs. `mark_expired_if_pending` locks the row and uses the
  PostgreSQL clock; `accept_atomically` revalidates the same TTL with that clock after
  its locks, so accept/reject/withdraw remain race-safe.
  The mutation, its two destinations (`driver:*` and `ride:*`) and the ack are committed together
  in live. When the driver (re)connects, `driver_ws` keeps the defensive sweep.
- **Rating**: `POST /{id}/rating` creates a `RideRating` (score 1–5, unique per `(ride_id, rater_id)`)
  and recalculates the average `rating` of the rated `User`.

## Account with two modes (passenger ↔ driver)

`User.role` is the account's **active mode**, never "both at once": everything that already
decides by role (history, pending rating, WS guards, `create_ride_request`…) stays
valid without changes. A driver registers **up to one vehicle per type** (`DriverVehicle`, table
`driver_vehicles`: taxi, moto, truck), each with its services and review status.
`users.vehicle_type/plate/vehicle_model/driver_services` are the **active vehicle** (the one chosen when
entering driver mode; it is what the pool and offers read) and `users.driver_status` the aggregate
(`approved` if any vehicle is):

- `POST /drivers/me/vehicles` (`RegisterDriverVehicle`) creates or updates the vehicle of that type
  → `status=pending`, or `approved` instantly if `DRIVER_AUTO_APPROVE=true` (development/testing;
  **forbidden in production**, `Settings` rejects it). The first vehicle becomes the active one.
  In driver mode the active vehicle cannot be edited or removed (the others can).
  Operator review is F04-A (pending); meanwhile, on hosted environments without
  auto-approval you have to approve in the database (`driver_vehicles.status='approved'`).
- `POST /drivers/me/mode` (`SwitchAccountMode`): switching to `driver` requires an approved vehicle
  (explicit `vehicle_type`, the only approved one, or the active one if still approved), without an active ride
  as a passenger; switching vehicle in driver mode requires being offline. Switching to `passenger`
  requires being offline and without a ride in progress. Vehicles are kept in both modes.

## Real time (WebSocket)

Endpoints in `api/v1/ws/negotiation.py` (auth: `viajaya.auth` subprotocols + access token,
outside the URL and access logs; close 1008 if invalid):

- **`WS /ws/rides/{ride_id}`** — owning passenger. Initial `offers_snapshot` + `ride_topic` events.
- **`WS /ws/driver`** — online driver. Ordered handshake `open_rides_snapshot` →
  `driver_offers_snapshot` → `driver_active_ride` (if any); excludes expired offers and recovers
  pending offers/active ride on restart. Afterwards it receives events from one
  `pool:{service}` per offered service (`offered_services`) and from `driver:{id}`. A delivery barrier avoids the
  blind window between snapshot and subscription. `open_rides_snapshot.data` uses
  `{items, next_cursor}`; `paused_rides_snapshot.data` keeps its list.

With `REALTIME_OUTBOX_DISPATCH_MODE=live_local|live_redis`, each socket instead receives a
single v2 snapshot (`ride_snapshot` or `driver_snapshot`) with watermarks, followed
exclusively by durable v2 envelopes. The local barrier subscribes before the
capture; deltas already included fall below the watermark and the client
deduplicates them. In any other mode the previous legacy handshake is kept
exactly.

**Events** (`api/v1/events.py`, published via `hub.broadcast` to `ride_topic`/`driver_topic`/`pool_topic`):

```
ride_created, ride_closed, ride_paused, offer_created, offer_rejected,
offer_withdrawn, offer_accepted, offers_withdrawn (plural), offer_expired, ride_status
```

- `offers_withdrawn` (plural) → to the chosen or disconnected driver: keeps
  `ride_ids` for legacy clients and adds `offers: [{ride_id, offer_id}]` so
  a late delivery does not withdraw a later re-offer. New producers
  emit both fields in the same order; the v2 envelope requires `offers`.
- Every current producer of `ride_closed` includes `pool_version` and
  `reason=paused|terminal`. Both are optional only when reading historical legacy;
  the v2 envelope requires them.
- Client polling remains **only as a slow fallback**; the primary path is the WS.
- Creating/replacing/withdrawing/rejecting/expiring an offer, accepting an offer, advancing,
  changing availability, pausing, cancelling,
  renewing the pool and announcing presence already persist their ordered batches
  in `realtime_outbox` before the commit when
  `REALTIME_OUTBOX_RECORDING_ENABLED=true`; direct delivery reuses those
  same `{type,data}` payloads. The `shadow` dispatcher only validates and marks the
  durable copy; direct publication remains the only delivery to the
  client. Both live modes switch both pieces atomically: the dispatcher
  delivers durable v2 metadata and the hub blocks the legacy direct path during
  the whole lifespan. `live_redis` enables several hubs only behind the
  shared-presence flag and with `cancel_absent_ride` in the live scheduler.

Presence (`api/v1/presence.py`): the request appears in `/rides/open` while the passenger is
connected to the WS or within the grace window (`PRESENCE_GRACE_SECONDS = 120`). Minimizing/switching
screens does not remove it; `GET /rides/me/active` renews presence while HTTP stays alive. Only
closing the app or losing both channels for the whole grace period cancels the search.

## Migrations (Alembic)

- Config: `alembic.ini` + `migrations/env.py` (**async** engine with `async_engine_from_config`).
- **28 migrations** in `migrations/versions/` (`0001_create_users` …
  `0028_driver_vehicles`). `0025` rejects the downgrade if there are phone-only accounts.
  `0027` adds `users.driver_services` (JSON/JSONB) and `driver_status`, and approves
  existing drivers with all the services of their vehicle. `0028` creates
  `driver_vehicles` and copies each driver's current vehicle there.
- Important: enums are persisted by lowercase **value** via `values_callable=_enum_values`
  in `infrastructure/db/models.py` (migration `0006_normalize_enum_values`). Do not break that convention
  or existing columns will fail.
- Offline mode is **not supported** (`env.py` rejects it). Commands: `alembic upgrade head`,
  `alembic revision -m "..."` (review the autogenerated one).

## Seed and utilities

```bash
python -m scripts.seed        # idempotent; requires the DB up + alembic upgrade head
python -m scripts.smoke_ws    # smoke test of the WS flow against a live server (simulated passenger + driver)
```

`scripts/` is a namespace package (`__init__.py`). The seed creates 2 users per role with a
verified phone; sign in with the simulated OTP: passengers `+59170000001/2`, taxis `+59170000011/12`,
motos `+59170000021/22`, moving truck `+59170000031`. `scripts/phone_access.py` exposes `sign_in(client, phone)` for the smokes.

## Tests

- `tests/unit/` — UCs with doubles (`tests/fakes.py`), no real DB.
- `tests/e2e/` — full API against async SQLite (`aiosqlite`); fixtures in `conftest.py`
  (override of `get_session` and `get_oauth_verifiers` with `FakeVerifier`; synthetic settings with
  simulated OTP, never the `.env`; `@pytest.mark.settings(**overrides)` adjusts those settings
  per test, e.g. `driver_auto_approve=True`). `tests/e2e/helpers.py` authenticates by phone:
  `sign_in(client, label)` / `sign_in_sync` and `promote_to_driver(session_factory, label, vehicle)`.
- `tests/e2e/test_negotiation_ws.py` — passenger↔driver WS negotiation flow.
- `tests/postgresql/` — opt-in destructive certification against an exclusively
  disposable database given by `VIAJAYA_TEST_DATABASE_URL`; skips if the variable does not exist.
  `test_pg_outbox_0018.py` verifies the migration cycle and that two workers
  claim complete, disjoint batches with `SKIP LOCKED`;
  `test_pg_outbox_0020.py` certifies the quarantine and its protected downgrade.
- `.github/workflows/ci.yml` runs in parallel the fast suite, the PostgreSQL 16
  certification and the mobile TypeScript/ESLint checks. The OpenAPI gate
  (`oasdiff breaking` against the PR base) rejects contract breaks; an intentional
  break is recorded with a date in `openapi-breaking-accepted.txt` (method, path and
  change text), never silence one that was not intended.
- `asyncio_mode = "auto"` (pytest-asyncio): `@pytest.mark.asyncio` is not needed.
- When adding a UC or endpoint, add its unit and/or e2e test.

## Conventions

- Async end to end (FastAPI, async SQLAlchemy, `async def` repos).
- `from __future__ import annotations` at the top of every module; type hints everywhere.
- Code, identifiers, docstrings, comments and documentation in **English**, per the persistent preference in `../AGENTS.md`. Verify every implementation before delivering it.
- Ruff with `line-length = 100`, `target-version = "py311"`, rules `E,F,I,UP,B,C4`.
- Imports sorted by isort (rule `I`).
