# Plan 0008 — Architecture hardening and real-time scaling

> **Status:** implementation finished; local validation passed and environment
> operational validation pending.
> **Created:** 2026-07-18.
> **Scope:** backend, mobile, shared contract and operations.
> **Strategy:** incremental evolution of the modular monolith; it is not split into
> microservices.

> **Local validation 2026-07-23:** the 557 fast tests and the 69 opt-in
> PostgreSQL/Redis tests passed, including the TCP, crash/replay,
> Redis restart, durable scheduler and two-workers-with-shared-presence tests.
> Ruff, OpenAPI export and generation, `oasdiff`, TypeScript,
> lint and the 10 mobile tests also passed. `promtool` validated 21 rules; `amtool` validated the
> configuration and the Compose profile started both services on loopback and
> accepted a local synthetic alert. An Android 14 AVD also ran the production
> React Native hook against duplicate, gap, invalid frame and
> quarantine/`1012` close; all converged through a snapshot. The
> crash/replay smoke now covers the two critical windows both in `live_local` and
> in `live_redis`. Only the rollout with representative traffic and the real
> integration of the metrics receiver/perimeter remain open.

## Context

The current architecture separates domain, application, infrastructure and API, and already
protects the main negotiation races with atomic operations.
The quality checks are green, but there are three limits that would prevent
scaling the deployment safely:

1. The WebSocket hub, presence and timers live in the process
   memory. Two workers share neither connections, presence nor events.
2. Some views rebuild information with per-row queries or load
   full histories to find a single result.
3. The mobile contract trusts TypeScript casts for HTTP/WS data and mixes
   shared geographic types with a feature's location adapters.

While the transport stays in memory, the backend must run with **a single
worker**. This restriction is operational, not a permanent guarantee.

## Goals

- Keep the modular monolith and its Clean Architecture boundaries.
- Separate enriched reads from transactional repositories.
- Be able to run several API processes without losing presence or events.
- Persist events and deferred actions before considering them confirmed.
- Make the client tolerant to duplicates, reordering and invalid contracts.
- Add PostgreSQL tests for the guarantees SQLite cannot represent.

## Out of scope

- Splitting services by domain or introducing microservices.
- Changing the rule that the passenger decides the negotiation.
- Replacing PostgreSQL as the source of truth.
- Removing the fallback polling before checking the new transport in
  production.
- Implementing background location tracking.

## Design decisions

### Modular monolith

The application will keep being deployed as one unit. Redis will be coordination
infrastructure, not a new business source of truth. PostgreSQL keeps
rides, offers, statuses, pending events and deferred actions.

### Separate reads

Views that combine ride, participants, offer and rating will depend on an
application-layer read port. The SQLAlchemy adapter will return
complete projections without exposing ORM models or moving authorization logic to
infrastructure.

### At-least-once delivery

Durable events may be delivered more than once. Each envelope will have
`event_id`, `aggregate_id`, `aggregate_version`, `stream`, `stream_version`,
`occurred_at`, `type` and `data`. The aggregate version orders events related
to the same aggregate, even across fanouts; the stream version orders what
each topic sees and allows detecting real gaps. The client will deduplicate by
`event_id`, will only apply the next contiguous position of the stream and will request a
resnapshot on a jump. Snapshots will carry a bounded vector of watermarks:
exactly `ride:{id}` for the passenger; `pool:{vehicle_type}`,
`pool:delivery` and `driver:{id}` for the driver.

`event_id` identifies a specific outbox row/delivery; the fanouts of the same
mutation share a `batch_id`, but have different IDs. A lower
`aggregate_version` received through another stream is not discarded globally:
it may represent a delta the local projection still needs. Per-aggregate version
guards must live in each projection's reducer when the
newest event is a full state that really replaces the previous one.

### Presence fails safe

A Redis or worker outage must never cancel a ride that could still be
attended by a connected passenger. On doubt, the system keeps the search and
polling allows converging; the reaper will recover the work when the
infrastructure comes back.

## Phase 0 — Local improvements without changing contracts

### 0.1 Critical backend projections

- Create a `RideReadRepository` port in application.
- Resolve the driver's active ride with a status filter and `LIMIT 1`.
- Resolve history with counterpart, agreed price and rating in one query.
- Resolve the earnings projection in one query, keeping the business-day
  computation in `America/La_Paz`.
- Keep the HTTP schemas and WebSocket events intact.

### 0.2 Mobile geographic shared kernel

- Move `Coordinates` and `PlaceLabel` to `src/core/domain/geo.ts`.
- Avoid `booking/domain` depending on `home/data`.
- Keep temporary re-exports so as not to force a mass migration.

### Acceptance criteria

- The three read cases run one main query each.
- The results keep order, counterpart, price, rating and time zone.
- `booking/domain` does not import from any `data` layer.
- Pytest, Ruff, TypeScript and ESLint pass.

## Phase 1 — Read scaling and PostgreSQL integrity

> **Progress:** migration `0017_pg_integrity_indexes` implements the FK,
> constraints and indexes described below. History and pool already expose
> keyset-cursor pages and mobile consumes them with infinite React Query. `0017` passed the
> `0016 → 0017 → 0016 → 0017` cycle and the assignment race on a disposable
> PostgreSQL database. The local `viajaya` database is currently at `0023`, so
> it includes `0017`. A local trial with 25,000 users, 220,000 rides and
> 300,000 offers confirmed the expected indexes through
> `EXPLAIN (ANALYZE, BUFFERS)`: the usual history pages stayed
> below 1 ms, the hot pool around 3 ms and the
> extreme/cold queries between 33 and 73 ms. Applying and calibrating the full chain
> with the real volume and traffic of a deployed environment is still missing. The CI workflow
> runs the opt-in PostgreSQL suite on a disposable database.

### Pagination

- [x] Add a stable cursor to history and the open pool, based on
  `(created_at, id)`.
- [x] Define a maximum limit of 100 and a response with `items` and `next_cursor`.
- [x] Update repositories, schemas, mobile DTOs, WebSocket snapshot and React
  Query in the same delivery.
- [x] Keep earnings aggregated in SQL; return only the 10 recent rides.

### Implemented indexes

Create a manually reviewed Alembic migration and check the plans with
`EXPLAIN (ANALYZE, BUFFERS)` on representative data:

- `ride_requests(service_type, created_at DESC, id DESC)` partial for
  non-paused `SEARCHING` pool requests.
- `ride_requests(driver_id, status, created_at DESC, id DESC)` for active ride and history.
- `ride_requests(rider_id, status, created_at DESC, id DESC)` for recovery and history.
- `offers(ride_id, status, created_at DESC, id DESC)` and
  `offers(driver_id, status, created_at DESC, id DESC)`.
- A partial unique index to prevent more than one active assigned ride per driver.

Also add an FK for `accepted_offer_id` and database constraints for amounts,
ETA, ratings and pool versions. The migration runs a preflight before the
DDL and aborts with the detail of the incompatible data; it neither repairs nor deletes them
silently.

### PostgreSQL tests

The `tests/postgresql/` suite certifies the full `0017` cycle, its
constraints, FK and indexes, and the following races with truly
concurrent connections. `.github/workflows/ci.yml` runs it against PostgreSQL 16 in a
separate job:

- [x] two acceptances on the same ride;
- [x] acceptance versus manual and absence cancellation;
- [x] simultaneous offers from the same driver;
- [x] an attempt to assign a driver to two active rides;
- [x] concurrent ratings from the same user.

SQLite is kept for the fast suite, but it does not certify `FOR UPDATE`, partial
indexes or isolation levels.

## Phase 2 — Validated and versioned HTTP/WS contract

### HTTP

- [x] Export a deterministic OpenAPI snapshot and check that it is current in CI.
- [x] Generate reproducible TypeScript types from OpenAPI and consume them
  gradually in the mobile repositories. The core DTOs of rides, offers
  and pool already reference the generated contract.
- [x] Keep explicit mappers from `snake_case` DTOs → `camelCase` domain.
- [x] Detect any schema drift as a CI failure. On pull requests,
  `oasdiff` compares the base branch snapshot with the candidate and blocks
  incompatible or potentially incompatible changes (`WARN|ERR`); the existing
  deterministic check still requires the snapshot to match the code.

The generator lives isolated in the root tooling package and only produces
types: it adds no other HTTP client and does not replace the mappers. History and earnings
also consume the generated contract: their always-serialized fields are
required but nullable in OpenAPI, aligning the schema with the real response
without removing the explicit DTO → domain normalization.

### WebSocket

- [x] Define the current 15 envelopes and payloads as discriminated Pydantic
  schemas and build them before every emission.
- [x] Keep equivalent per-socket Zod schemas in mobile.
- [x] Parse each message before mutating React Query or Zustand.
- [x] Extract pure reducers for the passenger's offers and the shared ride
  statuses; `openRidesCache` already reduces the driver's pool. The hooks
  keep only the coordination of socket, cache, stores and UI effects.
- [x] Log invalid events with sanitized metadata, without including tokens,
  URL, frame or payload.

The mobile consumer is deliberately tolerant of additional fields to
allow compatible payload extensions; it keeps rejecting unknown types,
missing mandatory fields and invalid values.

### Compatibility

During a transition version, the client will accept the current envelope and the
new versioned envelope. The backend will only remove the old format when the
minimum supported app version already understands the new contract.

Subphase 2.1 keeps the current `{type, data}` envelope. No ephemeral
`event_id` or `aggregate_version` will be added: those guarantees must be born in the
same transaction as the mutation through the phase 3 outbox. Adding them
earlier would create a false guarantee of order and durability.

The base of the v2 contract is already wired to the socket behind the
`live_local` canary mode. The backend has strict schemas for the durable envelope and
the unified snapshots, plus a serializer that translates canonical outbox
batches. Mobile uses dual parsers: if a frame includes any
reserved v2 key it must satisfy the full contract and it never silently degrades
to legacy within the same connection. A new connection can
negotiate legacy again to allow rollback. Both sides bound
versions and sequences to JSON's maximum safe integer.

The passenger snapshot contains `{ride, offers}` and a single watermark. The
driver's contains `{open_rides, paused_rides, offers, active_ride}` and the three
streams it actually consumes. `snapshot_id` and `captured_at` identify the
capture. A specialized `RealtimeSnapshotReader` already builds both
projections with its own short session. In PostgreSQL, its first statement
sets `REPEATABLE READ READ ONLY`; state, database clock and watermarks are read under
that same cut, preserving the requested order and using version `0` when the
stream does not have a counter yet. The capture only filters expired offers: it does not
run DML or maintenance, and its enriched queries avoid N+1 on the
passenger's offers and the driver's paused rides.

The opt-in PostgreSQL test pauses the capture between state and watermarks, commits
a concurrent write and proves that both stay at the previous
version. A new capture will see both new values. The use cases derive
the authorized streams and an API adapter translates the enriched DTOs to the
Pydantic schema without additional IO. In `live_local`, the WebSocket subscribes under the
barrier, captures with this reader and sends a single v2 snapshot; in `off|shadow`
it keeps the legacy handshake. Every mutation that emits live deltas already
records its durable batch. Presence and expiry are still in memory, so
this connection only certifies the single-worker vertical.

Mobile integrates a pure replay gate in both hooks. It decides `apply`, `drop` or `resync`
without advancing cursors and only confirms them after the handler completes the
cache mutation. This way a handler failure allows retrying the event. The gate
deduplicates the same delivery and detects contradictory reuse of `event_id`
including a canonical fingerprint of `{type, data}`. The socket serializes frames per
generation, discards queued callbacks from replaced connections and exposes
`resync()` to renew the snapshot on a gap, an invalid contract or a handler
failure. Visual effects run after the ticket is confirmed.

The race between a driver snapshot and an offer `201` does not use
`created_at <= captured_at`: PostgreSQL `now()` orders transaction starts, not
commits, and JavaScript would lose microseconds. Mobile keeps the local sequence
of attempts covered by each snapshot; a missing response that was already in
flight is considered ambiguous and forces another authoritative handshake.

### Tests

- [x] Snapshot followed by deltas in the existing WebSocket e2e tests.
- [x] Exact retry of a delivery in the pure gate; reusing the same `event_id`
  with another stream, metadata or payload forces a resnapshot.
- [x] A late event with a lower `aggregate_version` on another stream: the
  delta is kept if its stream position is contiguous, without global regressions.
- [x] A snapshot newer than the local events and rejection of old snapshots.
- [x] Integrate the gate into the socket and certify duplicates, gaps, handler
  failure, replaced generations and resnapshot in the transport pieces.
- [x] Invalid payload, invalid reason and unknown type in the backend contract.
- [x] An HTTP GET started before a WebSocket event and resolved after it: a
  test with a real `QueryClient` certifies that the cache keeps the event.
- [x] An HTTP mutation that returns an earlier state after a WS terminal:
  the callbacks first query the canonical detail and do not revive the ride.

The pass of the production hook in React Native is kept as the canonical pending
criterion in the phase 3 hardening; the headless smokes do not certify the
mobile runtime.

The current barrier only prevents regressions from terminal states. Ordering two
concurrent non-terminal states requires `aggregate_version` and is tied to
the phase 3 outbox. Ride queries propagate React Query's `AbortSignal`
to Axios: `cancelQueries` also interrupts the HTTP transport, in addition
to preventing an earlier response from modifying the cache.

## Phase 3 — Durable and multi-worker real time

### 3.1 Unit of work and outbox

> **Progress:** `0018_realtime_outbox` creates the outbox and the transactional counter
> per aggregate. `0019_realtime_stream_versions` adds an independent counter
> per topic, `stream_version`, its deterministic backfill and the indexes to
> preserve the visible order of each stream.
> `0020_realtime_outbox_quarantine` separates the terminal quarantine from
> publication and transient retry. A deterministic contract error sets aside
> the whole batch with a stable code, stops blocking its streams and keeps
> the rows for audit; the resulting gap forces a resnapshot before
> continuing the live replay.
> `0021_realtime_outbox_batch_size` persists the expected cardinality of each
> batch, validates that every sequence stays within it and adds the partial index
> of published rows used by retention. The consumer rejects a truncated batch
> before emitting it.
> `CreateOffer`/replacement, `AcceptOffer`, `PauseRideForEdit`, `CancelRide`, the
> automatic absence closing, `UpdateRideFare`, `EditRide`,
> `AnnounceOpenRide`, `WithdrawOffer`, `RejectOffer`, `ExpireOffer` and
> `UpdateRideStatus`, plus `SetDriverOnline`, are the first
> producers: mutation, ordered batch and versions are committed in a single commit through
> `UnitOfWork`; direct publication reuses exactly the persisted
> payloads. `CreateRideRequest` also delegates the commit to the application, but
> does not record `ride_created`: the new request is only announced when the passenger confirms
> presence over WebSocket. Pool renewals standardize the batch
> `ride_status → ride_created` and capture before the commit both the passenger's
> detail and the enriched public projection. The acceptance fanout keeps
> `ride_status`, the pool closing,
> the winner's notification/cleanup and the withdrawals/rejections of those affected in a
> single multi-stream batch. The recorder is behind
> `REALTIME_OUTBOX_RECORDING_ENABLED=false` and the dispatcher is controlled with
> `REALTIME_OUTBOX_DISPATCH_MODE=off|shadow|live_local|live_redis`, off by default. The
> shadow mode only claims, validates and marks batches. `live_local` requires
> recording, pre-serializes the whole v2 batch, delivers it in order to the process
> hub and only then marks `published_at`; at the same time it turns off the legacy
> direct path and enables the v2 snapshots. A transient failure keeps the
> batch with backoff and a quarantine first commits the gap and then forces
> a 1012 close/resnapshot of all its sockets. The lifecycle runs a preflight,
> uses a new session per iteration and stops the loop in a coordinated way. This
> mode does not enable multiple workers: it is a local canary before the Redis bridge.
> `live_redis` keeps the same envelopes and snapshots, but publishes each batch
> to a shared channel and keeps one subscriber per process. Pub/Sub does not replace
> PostgreSQL durability: a disconnection evicts sockets with 1012 and a
> publish without subscribers retries the row. The legacy advisory key keeps
> `live_redis` exclusive by default; it is only shared after deploying the
> compatible binary on every replica and enabling presence + the live scheduler.
> The PostgreSQL suite also has test-only one-shot injection,
> outside the production artifact. Over a real TCP WebSocket it certifies a duplicated
> delivery, an intentional version jump, the later continuity of the
> stream, a confirmed quarantine, the `1012` close and a new authoritative
> snapshot. This smoke does not run the React Native client or force a crash
> of the API process. A second, test-only multi-process smoke forces with
> `SIGKILL` both `commit → publish` and `publish → published_at`. PostgreSQL
> rolls back the unfinished claim and releases the advisory lock; another instance on
> the same database publishes or redelivers the same durable identity depending on the window,
> confirms `published_at` and returns a snapshot whose watermark covers the event.
> This crash certification remains limited to `live_local` with one process and
> will have to be repeated on `live_redis`.
> The local `viajaya` database is at `0023` and includes `0018`–`0022`; the destructive
> PostgreSQL tests remain opt-in and CI runs them on a disposable
> database.
> The initial announcement and each re-announcement on reconnect take a lock on the
> ride, revalidate `SEARCHING && !paused` and record a single `ride_created`
> before the commit. The HTTP heartbeat keeps its role of renewing the grace and
> does not create periodic events. In `off|shadow`, direct publication happens
> after the commit and keeps best-effort order; `live_local` suppresses it and
> delivers exclusively the durable v2 copy.
> Voluntary withdrawal of an offer also uses compare-and-set + outbox + UoW;
> its single `offer_withdrawn` shares a builder between the durable copy and the socket.
> Explicit rejection replicates the same boundary and records a single
> `offer_rejected(reason=declined)` in the driver's personal stream.
> Expiry records in a single batch `offer_expired` first in the driver's
> stream and then in the ride's. Both events belong to the ride
> aggregate; a fresh read under lock prevents the sweep of a stale ORM
> session from overwriting a concurrent acceptance, rejection or withdrawal. The
> 30 s timer only continues as a fallback in `off|shadow`; in `live`, the durable
> `expire_offer` action completely replaces the local timer.
> Each ride advance captures the exact enriched detail before the commit and
> records `ride_status` first in the ride's stream and then in the
> driver's. The router returns that same detail, without a second read that
> could coalesce a later concurrent transition.
> Driver availability also uses a single transaction. Going
> offline first records one `offer_withdrawn(reason=driver_offline)` per live
> offer, in the order delivered by the transition, and ends with
> `offers_withdrawn` on the driver aggregate. Going back online, going offline without
> offers or resolving only already expired offers does not create an empty batch.

To publish an event after a commit without a loss window, the mutation
and the event record must belong to the same transaction. A
`UnitOfWork` was introduced in application incrementally; the migrated repositories
do `flush` and the unit of work decides `commit`/`rollback`.

Current `realtime_outbox` schema:

- `id UUID` (`event_id`);
- `batch_id`, `sequence` and `batch_size` to certify the complete batch;
- `event_type`, `topic`;
- `aggregate_type`, `aggregate_id`, `aggregate_version`;
- `stream_version`, unique and increasing within each `topic`;
- `payload JSONB`;
- `created_at`, `published_at`;
- `quarantined_at`, `quarantine_code` for an explicit terminal exit;
- `attempts`, `last_error`.

The implementation also adds `batch_id` + `sequence` to preserve the order
of fanouts and `next_attempt_at` to avoid hot retries. The
`realtime_aggregate_versions` table assigns versions inside the transaction; `pool_version`
is not reused, because that counter does not change on every event.
`realtime_stream_versions` reserves ranges per topic in the same transaction. The
producers first acquire the aggregate counters and then the stream ones,
both in a deterministic order, to avoid deadlocks in multi-topic batches.

The claim only considers a batch if none of its members has an earlier
unpublished row in the same topic. `SKIP LOCKED` lets another dispatcher
advance independent streams, but never jump ahead to a later version of the
same stream. A transient failure keeps that block and uses backoff. An invalid
batch is quarantined whole on the first attempt: it stops participating in the
pending predicates and releases its streams only after the commit. Its versions
are not reused; the gap forces a live client to request another snapshot.

A dispatcher claims rows with `FOR UPDATE SKIP LOCKED`, publishes to the transport and
marks `published_at`. If it dies after publishing and before marking, the event
is repeated; that is why client idempotency is mandatory. The transport
of `live_local` is still the process hub. The `live_redis` mode publishes the
whole batch over Pub/Sub and each replica delivers it to its own local hub.

The **shadow** dispatcher does not publish: it certifies claim, validation and
lifecycle using the real outbox, marks the processed rows and leaves direct
delivery as the only visible path. `live_local` is the next canary step.
Both require `0018`–`0021`. The flag sequence is:

1. `off` + recording `false`: the safe, default state;
2. `shadow` + recording `false`: check startup/shutdown and drain any
   previous backlog without delivering it;
3. `shadow` + recording `true`: record and debug in shadow while comparing
   with direct publication;
4. `live_local` + recording `true`: only after draining the backlog, deliver
   v2 envelopes/snapshots with exactly one worker;
5. `live_redis` + recording `true`: enable the Redis transport with one worker;
6. `live` scheduler + `REALTIME_SHARED_PRESENCE_ENABLED=true`: promote to several
   replicas only after all of them run the compatible binary.

`off` + recording `true` is not a deployable combination. Before enabling
live delivery, check that no reproducible shadow backlog remains. The
Redis mode removes the hub's technical limit, but the lock rejects a second worker
until presence is shared; a negotiation smoke does not replace that dependency.

Direct publication stays available for `off|shadow`; the lifecycle
disables it globally during `live_local|live_redis`, avoiding a double
delivery to the same socket.

Base already fulfilled by `93b9741`:

- [x] Create the `0018` schema, indexes, constraints and downgrade.
- [x] Claim whole batches with `FOR UPDATE SKIP LOCKED` and release them on
  rollback.
- [x] Migrate offer creation/replacement to `flush` + outbox + UoW commit.
- [x] Reuse the same canonical builder for the outbox and direct WebSocket.
- [x] Protect the producer with a feature flag off by default so as not to create
  a historical backlog impossible to reproduce safely.
- [x] Add `0019`, reserve positions per stream without deadlocks and prevent
  concurrent claims from jumping ahead of a batch of the same topic.
- [x] Define and test the v2 envelope, snapshots with watermarks, the dual mobile
  parser and the pure idempotency gate without changing the current emission.
- [x] Capture v2 state and watermarks under a single PostgreSQL
  `REPEATABLE READ READ ONLY` transaction, without mutations or N+1 on the critical collections.
- [x] Migrate the atomic acceptance to `flush` + outbox + UoW commit and
  reuse the same canonical batch in direct publication.
- [x] Migrate pause-for-edit to the same UoW; capture the enriched detail
  before the commit and preserve `ride_closed → offer_withdrawn → ride_paused`.
- [x] Migrate manual and absence cancellation to the same UoW; capture the detail
  before the commit and preserve `ride_status → ride_closed → offer_rejected[]`,
  including the personal `ride_status` when a driver is already assigned.
- [x] Migrate ride creation to `flush` + UoW commit without announcing it before
  presence, and migrate fare/edit to a shared durable builder
  `ride_status → ride_created` with an enriched payload before the commit.
- [x] Add `0020` and an atomic terminal quarantine for invalid batches, with
  closed codes, indexes that exclude terminal rows and a protected downgrade.
- [x] Add `0021`, durable per-row cardinality and a partial index by
  `published_at`; the backfill fixes the historical cut and the new producers
  write `batch_size` inside the same transaction.

Shadow dispatcher and local canary:

- [x] Run the dispatcher in shadow mode with lifecycle and coordinated shutdown.
- [x] Validate before marking that batch, sequence, `event_id`, version,
  `event_type`, topic and canonical payload match; deterministic errors use
  a sanitized quarantine and only transient failures keep backoff.
- [ ] Enable it in an environment with `0018`–`0023`, clean up the shadow backlog and
  compare its batches with direct publication before enabling real delivery.
  The procedure, gates and rollback are versioned in
  `docs/runbooks/realtime-rollout.md`; the task stays open until it is run
  with representative environment traffic.
- [x] Measure pending items, batches, retries, quarantines, maximum age and the conservative
  `created_at → published_at` delay through `/health/realtime`; define an
  opt-in retention of published rows by whole batches, disabled by default.
- [x] Add `live_local` with `event_id` envelopes, aggregate/stream
  versions, snapshots with watermarks and the integrated mobile gate, without claiming
  multi-worker support.
- [x] Migrate cancellation with a single canonical builder and the `ride` aggregate; this
  operation does not mutate other rides and orders its rejections by offer UUID.
- [x] Migrate the initial presence announcement/re-announcement with a lock and the
  `SEARCHING && !paused` revalidation; do not record `ride_created` from the creation POST.
- [x] Migrate voluntary offer withdrawal to compare-and-set + outbox + UoW
  commit; keep a single `offer_withdrawn` in the ride's stream.
- [x] Migrate explicit offer rejection to compare-and-set + outbox + UoW
  commit; keep `offer_rejected(reason=declined)` in the driver's stream.
- [x] Migrate expiry to UoW + outbox, keep the
  `driver:* → ride:*` batch and revalidate a fresh ORM entity under lock before
  marking `EXPIRED`.
- [x] Migrate the `ARRIVING → IN_PROGRESS → COMPLETED` advances to UoW + outbox;
  capture the enriched detail before the commit and keep the
  `ride:* → driver:*` fanout with the same exact state over HTTP and WebSocket.
- [x] Migrate driver availability to UoW + outbox; withdraw all their
  pending offers in the same commit and keep the personal summary at the
  end of the batch, without emitting for already expired offers or empty changes.

- [x] Make the reduction of `ride_closed` and the personal outcome commutative in mobile:
  the pool closing only removes the visible offer and preserves the
  tombstones/states that arrive through the driver stream in any order.

- [x] Version the legacy pool cycle before `live`: each reopening advances
  `pool_version` even if no visible fields change; `ride_closed` adds the
  generation and `reason=paused|terminal`. The bounded mobile projection ignores
  duplicated or late `ride_created`/closings, keeps outcomes of the same
  generation and makes pause, terminal closing and service change commute between
  streams. Legacy temporarily tolerates the missing fields, while v2
  requires them so as not to weaken its guarantee. The rollout of this contract deploys
  backend first and then mobile: a legacy producer without those fields only
  admits the previous best-effort fallback.

- [x] Make the driver's `offer_expired` consumer compare `offer_id`:
  an event of an earlier offer no longer expires the new one of the same ride and a
  duplicate does not repeat state or notification. The local timer uses the same CAS.
- [x] Prevent `ride_status` regressions according to
  `SEARCHING → ACCEPTED → ARRIVING → IN_PROGRESS → COMPLETED`, keeping the
  refresh of the same state and the lateral `CANCELLED` exit before starting. The
  guard cross-checks detail + active and also protects unversioned HTTP responses.
- [x] Mitigate the legacy `offers_withdrawn` summary: mobile removes only the
  declared `ride_ids` and a successful offline HTTP call clears the live offers even if
  the WebSocket is down.
- [x] Extend `offers_withdrawn` before `live` with exact
  `{ride_id, offer_id}` pairs. Producers keep `ride_ids` for legacy
  clients and add `offers` in the same order; v2 requires those identities. Mobile
  does compare-and-set by `offer_id`, seals duplicates and late events without
  withdrawing or invalidating a later re-offer on the same ride.
- [x] Arbitrate the HTTP creation/WS event race with bounded tombstones by
  `offer_id`, a token per attempt, a lock per terminal ride and a CAS `markOffered`.
  A late response no longer revives a rejection, expiry, pause, acceptance,
  withdrawal, taken ride or cancellation, nor wins over a new attempt. The
  PostgreSQL `PENDING` snapshot prevails over a contradictory local expiry; if
  an in-flight attempt is missing from the cut, it is resolved with another snapshot and
  not by comparing timestamps of concurrent transactions.

Hardening before promoting the canary:

- [x] Prevent at runtime PostgreSQL consumers of incompatible modes from
  coexisting against the same database. The previous version's key remains as a
  rolling-deploy barrier: several shadow ones can coexist, but live_local and
  live_redis are exclusive. The dispatcher polls the owning session and
  stops fail-closed if it loses it.
- [x] Add liveness/readiness and a sanitized snapshot of backlog, age,
  retries, quarantines and publication delay; the read does not expose payload,
  topic, DSN or internal errors.
- [x] Add opt-in retention of published rows, with a TTL of `0` by default,
  a per-batch limit, verified cardinality, separate sessions and coordinated
  shutdown. Quarantines and counters are never pruned. The opt-in
  PostgreSQL suite certifies two concurrent purges with `SKIP LOCKED`, without
  double counting or fragmentation, and version continuity after the purge.
- [x] Export these signals to OpenMetrics 1.0 behind an opt-in, with bounded
  labels, sanitized failure and versioned PromQL rules validated by
  `promtool` in CI. `/health/realtime` keeps its JSON contract for
  human diagnosis.
- [ ] Wire the environment's scrape and Alertmanager, restrict `/metrics` by
  network and tune thresholds with staging traffic.
  The repository already includes a Compose profile with scrape, rules, a local
  Alertmanager without external destinations, a secret configuration mount and validation of
  both files in CI. The task stays open until the real receiver and
  perimeter are wired, and the thresholds calibrated in staging.
- [x] Run backend JSON → mobile parser contract tests through a
  deterministic fixture generated by the production serializers and verified
  against both Zod parsers in CI.
- [x] Run a headless smoke with real PostgreSQL, Uvicorn, HTTP and TCP WebSocket
  in `live_local`: v2 snapshot, durable delta, controlled close, new
  handshake, authoritative snapshot and final draining are certified in the CI
  PostgreSQL suite.
- [x] Extend the headless smoke with test-only one-shot injection,
  outside the production artifact: duplicated delivery over TCP, an observable version
  jump, later continuity of the stream, a batch quarantined
  after the commit, a `1012` close and a new snapshot whose watermark skips the
  unpublished event.
- [x] Force a crash/restart after the commit and before publishing: a new instance
  against the same PostgreSQL claims the same pending row, emits its
  envelope and confirms `published_at` without losing or recreating the event.
- [x] Force a crash/restart after publishing and before confirming
  `published_at`: the new instance redelivers exactly the same `event_id`
  and the new handshake returns an authoritative snapshot whose watermark covers
  that version. Duplication is the expected at-least-once delivery
  semantics.
- [x] Repeat both crash windows with the real Redis bridge and subscription:
  the replay keeps the durable identity and converges through a snapshot in
  `live_redis`, without remote controls or production flags.
- [x] Run the pass of the production hook on a React Native dev build against
  duplicate, gap, invalid frame and quarantine/`1012` close, and keep the
  evidence described in
  `docs/runbooks/smoke-realtime.md`.
  The interactive runner lives outside `app`, arms one-shot failures by direct
  reference and exposes no network controls. The 2026-07-23 pass used an
  Android 14 AVD and confirmed `dropped/duplicate`, `resync/stream_gap`,
  `invalid_frame` + `resync/invalid_frame` and a `1012` close, all followed by
  reconnection and a snapshot where applicable.
- [x] Make snapshot application indivisible between React Query and Zustand,
  and prevent an already started handler from emitting effects after its
  generation is invalidated. Each physical socket opens a generation, commits revalidate their
  guard after IO and the driver snapshot uses a single store transition
  with grouped Query notifications.
- [x] Protect the batch against truncation after `0021` through
  durable cardinality, validation before publishing and an audit of all
  pending items during the preflight, including batches without an anchor. The backfill
  sets the observable cardinality of the existing historical batches,
  but it cannot rebuild a tail already missing before `0021`.
- [x] Remove the late copy of an earlier HTTP result from
  `usePassengerActiveRide` into the detail after a newer snapshot;
  the optimization now keeps the source `dataUpdatedAt` and never overwrites an
  equal, later or terminal projection.

### 3.2 Redis bridge and local sockets

- [x] Each process keeps only its local sockets.
- [x] One Redis subscriber per process receives validated v2 batches and delivers them
  to the local hub, keeping `ride:*`, `driver:*` and `pool:*`.
- [x] The publisher requires at least one confirmed subscriber; a failure keeps the
  PostgreSQL batch for retry and does not mark `published_at`.
- [x] Losing Pub/Sub or receiving an invalid message closes all local
  sockets with 1012; the later handshake recovers snapshot and watermarks. The
  absence timers wait while the shared transport is not healthy.
- [x] Reconnecting Redis has backoff, readiness and sanitized metrics.
- [x] The suite tests two hubs with a simulated broker and with real Redis in CI; it also forces
  subscriber loss, the 1012 close and reconnection.
- [x] Reject the second `live_redis` Uvicorn process while presence stays
  local and allow it only with shared presence + the live scheduler.
- [x] Publish canonical batches of more than 1000 events when they fit in the frame;
  if they exceed the bytes, a `transport_limit` quarantine + resnapshot avoids infinite retry.
- [x] Restart a dedicated Redis server between commit and publication: the socket
  closes with 1012, the batch stays pending and the replay keeps `event_id`,
  `batch_id`, sequence and version after reconnection.

The smoke keeps the gate without the flag and certifies two real Uvicorns with the flag: the
passenger and the driver connect to different processes and complete the negotiation.

### 3.3 Shared presence

- [x] Redis keeps **per-connection leases**, not a single boolean per ride. A
  possible representation is a sorted set `presence:ride:{ride_id}` whose
  members are `ws:{connection_id}` and `http`, with the expiry as the score.
- [x] The gateway renews its member periodically while the WS stays alive; the
  `GET /rides/me/active` endpoint will renew the HTTP member.
- [x] Lua scripts prune expired members and check presence without a race
  between two connections or processes. Disconnecting one connection never removes the
  presence contributed by another.
- [x] Each activity/disconnection upserts a durable
  `cancel_absent_ride` action for `now + 120 s`. A reconnection or heartbeat will increment
  its `generation` and move the deadline, invalidating earlier executions.
- [x] Creating a ride schedules the first generation in the same transaction, so
  that dying before the first WebSocket does not leave an orphan `SEARCHING` either. Startup
  and the worker reconcile, with a full grace, the searches created
  by an earlier version.
- [x] The reaper only cancels if the ride is still `SEARCHING`, is not paused, the current
  generation expired and Redis confirms no live lease.
- [x] If Redis is unavailable or has just recovered, the reaper postpones the
  cancellation without consuming the retry limit.

> **Progress 2026-07-22:** `REALTIME_SHARED_PRESENCE_ENABLED=false` keeps a
> reversible rollout. Enabling it requires `live_redis`, recording and the live scheduler.
> The sorted sets use `Redis TIME`, `ws:{connection_id}`/`http` members, a bounded
> TTL and Lua to prune/observe atomically. Each pulse increments in
> PostgreSQL the generation of `cancel_absent_ride`; the executor takes fencing,
> revalidates Redis and commits cancellation + outbox + ack in a single UoW. The legacy
> lock stays exclusive without the flag and shared with the flag, blocking shadow and
> live_local. The real suites cover two connections, expiry, durable closing
> and a full negotiation between two Uvicorn processes. Creation also persists
> the first absence generation before the commit and the reconciler covers the
> pre-existing state without mass cancellations during the rollout.

### 3.4 Expiries and deferred actions

Replace `asyncio.create_task` with a `scheduled_actions` table:

- `id`, `dedupe_key`, `action_type`, `aggregate_id`, `generation`;
- `execute_at`, `payload JSONB`;
- `status`, `attempts`, `next_attempt_at`, `locked_at`, `last_error`.

Offer creation will insert `expire_offer` in the same transaction. Presence
activity will upsert `cancel_absent_ride`. Concurrent workers
will claim actions with `FOR UPDATE SKIP LOCKED`; the atomic use cases
will remain the final defense against races.

> **Progress 2026-07-22:** `0022_scheduled_actions` creates the durable queue with
> deduplication, generation, a recoverable lease and a fencing `lock_token`; it also
> backfills the `PENDING` offers respecting `created_at + 30 s`. Offer
> creation already persists `expire_offer` in its same UoW and the
> `off|shadow|live` rollout allows comparing the dual-write first. The action is recorded
> in all three modes; `off` keeps the timer, `shadow` runs worker + timer and
> keeps legacy delivery, and `live` depends exclusively on the worker. In live, the worker
> replaces the local timer, commits the expired offer + outbox + action ack in
> one transaction and recovers abandoned claims with `FOR UPDATE SKIP LOCKED`.
> PostgreSQL certifies two claimers, a stale token, a real `SIGKILL` after confirming
> the claim, recovery through the lease and a race between the shadow timer and the worker without
> duplicating the outbox. `cancel_absent_ride` now uses the same claims, leases and
> fencing, with a generation renewed by Redis presence. `/health/scheduled-actions` and `/metrics` expose only counts,
> ages and bounded types; Prometheus alerts on a stopped worker, overdue backlog,
> stuck leases and `dead` actions without publishing payloads or identifiers.
> Claims, leases, retries and TTL validation use PostgreSQL's
> `clock_timestamp()`. A mandatory retention deletes in batches only
> `succeeded/cancelled` actions; `dead` ones are kept indefinitely. Startup and each
> consumer cycle reconcile offers and searches without an action that an earlier
> pod may have created after the backfill, and the shadow legacy publication is
> decoupled from the handler timeout.

## Incremental deployment

1. Publish metrics and document the current single-worker limit.
2. Apply `0018`–`0023` and deploy the durable tables before the producing backend.
3. Deploy the dispatcher in `off` and then enable `shadow` with recording
   `false` to certify the lifecycle and drain the backlog.
4. Enable recording in shadow and compare batches, payloads and metrics against
   direct publication, still with one worker.
5. Emit versioned envelopes and update mobile for idempotency and
   watermarks.
6. Enable `live_redis` with one API worker and compare events/snapshots.
7. Disable timers and direct publication through feature flags.
8. Test forced restarts of API, Redis and workers. The API crash in
   `live_local|live_redis`, the full Redis restart with replay and the crash of the
   durable scheduler are certified on real processes/containers.
9. Enable shared presence and two API workers in staging; then promote to
   production with the gate, metrics and rollback by flag.

Each step must have a feature flag and a rollback that neither reverts migrations nor
deletes pending events.

## Minimum observability

- Local WS connections per topic and process.
- Commit → publication latency and pending outbox size.
- Overdue scheduled actions, retries and permanent failures.
- Presence renewals and expiries.
- Redis reconnections and messages dropped because of version/schema.
- Request/correlation ID propagated to logs and events. **Implemented:**
  `X-Request-ID` is validated as a UUID or replaced, returned over HTTP and
  kept in `realtime_outbox.correlation_id`/the v2 envelope. History uses
  `batch_id`; the scheduler uses the action ID and the migration keeps a trigger
  compatible with the earlier producer during a rolling deploy. Redis temporarily
  publishes a correlated wire and a legacy one on separate channels; the
  new consumer reads both, skips the legacy one if it already saw the batch and the gate
  tolerates the reverse order as a duplicated delivery.
- Readiness that checks PostgreSQL and, when applicable, Redis; liveness will not
  depend on external services.

JWTs, full subprotocols, Maps keys and payloads with personal data are not logged
without redaction.

## Final acceptance criteria

- Passenger and driver connected to different processes receive every event.
- Killing the API after the commit does not lose the notification: certified for
  `live_local` and `live_redis`; Redis also certifies a full restart/replay and the
  multi-process negotiation.
- Restarting workers does not prevent an offer from expiring nor leave an abandoned search.
- Redis down does not cause false cancellations.
- Duplicating or reordering events does not revert terminal states on mobile.
- Polling still converges and can be kept as a slow fallback.
- The PostgreSQL suite demonstrates the critical races.
- Two API workers pass the full negotiation smoke test.

## Verification per stage

```bash
# Backend
cd backend
.venv/bin/pytest
.venv/bin/ruff check .

# Mobile
cd mobile
npx tsc --noEmit
npm run lint
```

The Redis/outbox suite includes real integration and a smoke that forces
the passenger and the driver onto different Uvicorn processes.
