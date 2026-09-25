# Realtime smoke

The headless smoke certifies the single-process canary vertical with real
components: PostgreSQL at `head`, Uvicorn over TCP, HTTP, Bearer authentication and
WebSocket with the `viajaya.auth` + token subprotocols. It runs the
`live_local` mode with durable recording, receives a v2 snapshot, triggers a delta and
checks that a new connection converges through another authoritative snapshot.

## Headless run

Set `VIAJAYA_TEST_DATABASE_URL` to a disposable PostgreSQL database and run:

```bash
cd backend
VIAJAYA_TEST_REDIS_URL=redis://localhost:6379/15 \
.venv/bin/pytest \
  tests/postgresql/test_pg_realtime_network_smoke.py \
  tests/postgresql/test_pg_realtime_fault_smoke.py \
  tests/postgresql/test_pg_realtime_crash_smoke.py -q
```

The suite's shared guard rejects drivers other than
`postgresql+asyncpg` and databases whose name neither starts with `test_` nor ends in
`_test`. The fixture runs `downgrade base → upgrade head → downgrade base`, so
it deletes every Alembic-managed object in the given database.
Never point this variable at development, staging or production.

The base and one-shot smokes use users with a random suffix, an ephemeral loopback
port and bounded deadlines. In their `finally` they verify that the ride is cancelled,
set the driver offline, wait for the outbox to drain and shut down Uvicorn together
with its presence/expiry timers. The physical cleanup happens when the suite's
PostgreSQL fixture is torn down. They do not log JWTs, payloads or the database
URL.

The `live_local` cases do not require Redis. The `live_redis` crash
variants are skipped if `VIAJAYA_TEST_REDIS_URL` is not defined; when
enabled they use a random channel and do not write durable state to Redis.
This smoke is part of the CI job `Backend · PostgreSQL real` because it lives in
`tests/postgresql/`; it requires neither seed accounts nor a backend started
beforehand.

## Redis bridge

The same job starts Redis and defines `VIAJAYA_TEST_REDIS_URL`. The test
`test_pg_redis_realtime_bridge.py` opens two clients and two local hubs on a
random channel, publishes a durable envelope and requires the same identity in both
simulated processes. It then kills the Pub/Sub connections, requires a 1012 close of the
sockets and waits for both bridges to reconnect.

`test_pg_redis_multiworker_smoke.py` keeps two gates. Without the shared flag,
a second Uvicorn must fail. With `REALTIME_SHARED_PRESENCE_ENABLED=true` and the
live scheduler, it starts two processes against the same PostgreSQL/Redis: the
passenger connects to the first, the driver to the second, both receive snapshots and
the `ride_created → offer_created → offer_accepted` negotiation crosses processes.
`test_pg_shared_passenger_presence.py` also certifies the Lua scripts, per-connection
leases, grace and `cancel_absent_ride` with durable fencing.
The fast tests verify that ride creation persists the first absence
action in the same UoW and that the reconciler repairs legacy searches
idempotently before enabling multiple workers.

Every HTTP response includes `X-Request-ID`. To follow a mutation down to the
client, search for that UUID in the request's sanitized log, in
`realtime_outbox.correlation_id` and in the v2 envelope's `correlation_id`. The
scheduler actions use their own `scheduled_actions.id` as correlation.
Do not use JWTs, query strings or payloads as diagnostic identifiers.
During a rolling deploy, events created or delivered by an earlier
replica use `batch_id` as a stable fallback. The new bridge also publishes
a legacy copy on `REALTIME_REDIS_CHANNEL`; confirm there are no schema
resyncs before removing the compatibility in a future phase.

`test_pg_redis_restart_smoke.py` exclusively uses the service with the
`redis_restart_test` profile: it stops Redis after the commit and before the publish,
checks the 1012 close and the pending retry, starts the same container again and
requires a replay with identical `event_id`, `batch_id`, sequence and version. It rejects
non-loopback URLs, databases other than 15 and containers without a `test|ci` mark.
Locally:

```bash
docker compose up -d redis
docker compose --profile restart-smoke up -d redis_restart_test
cd backend
VIAJAYA_TEST_DATABASE_URL=postgresql+asyncpg://viajaya:viajaya@localhost:5432/test_viajaya \
VIAJAYA_TEST_REDIS_URL=redis://localhost:6379/15 \
VIAJAYA_TEST_REDIS_RESTART_URL=redis://localhost:6380/15 \
VIAJAYA_TEST_REDIS_RESTART_CONTAINER=viajaya_redis_restart_test \
.venv/bin/pytest \
  tests/postgresql/test_pg_redis_realtime_bridge.py \
  tests/postgresql/test_pg_redis_multiworker_smoke.py \
  tests/postgresql/test_pg_redis_restart_smoke.py -q
```

These tests certify transport, restart/replay and the conditional promotion
to multi-worker; they complement the unit cases for leases, invalid messages and
absence of subscribers.
The normal development/CI Redis is not interrupted during the restart smoke.

## Multi-process crash/restart

The crash smoke uses two consecutive Uvicorn processes, the same loopback
socket, the same PostgreSQL and the same fixed test JWT secret. The
gates are anonymous IPC objects of the runner; there are no endpoints, corruption
variables or remote controls in `app`. It requires POSIX for the explicit use
of `SIGKILL`; on other systems the test is skipped. Each case runs first
in `live_local` and then in `live_redis`. The second variant uses the real bridge,
Pub/Sub and subscription on an isolated channel.

It certifies these two windows separately:

- `commit → publish`: the first process is suspended before emitting and
  receives `SIGKILL`; the claim rolls back, the row stays pending and the second
  instance publishes with an empty hub. A later connection converges through its
  snapshot and watermark without depending on having received that delta.
- `publish → published_at`: the first socket receives the frame and the process dies
  before confirming; the second instance redelivers exactly the same
  `event_id`, `batch_id`, sequence, version and payload.

In both cases it checks exit by `SIGKILL`, an abnormal WebSocket close,
release and reacquisition of the advisory lock, `attempts == 0` after the crash,
`attempts == 1` and a confirmed `published_at` after the replay, plus a
new snapshot with a single offer and an exact watermark. In the post-publication
window, the recovery process stops before the replay only
inside the harness to let the real TCP socket observe the redelivery.
On the successful path it also verifies cancellation, driver offline, draining and
coordinated shutdown of the recovered instance. If an assertion already failed, an isolated
`off` app tries to clean up that state without hiding the primary error. On
2026-07-23 all four window and transport combinations passed.

## React Native dev build pass

The headless pass does not replace the React Native runtime. The technical
development observer keeps in a bounded buffer and writes with the `[realtime]` prefix
the close code, the discard cause and the resync reason. It only logs
the `passenger|driver` scope, closed categories, sequence and time; never routes,
ride IDs, tokens, frames or payloads. The buffer is disabled outside
`__DEV__`.

The runner `scripts/mobile_realtime_smoke.py` allows repeating the pass with a dev
build —never Expo Go— without adding controls to the production artifact. It starts a
`live_local` API on a disposable PostgreSQL database, creates an ephemeral
driver account and arms the failures only by direct reference inside the
process.

First bring the disposable database to `head` and start the runner:

```bash
cd backend
DATABASE_URL="$VIAJAYA_TEST_DATABASE_URL" .venv/bin/alembic upgrade head
.venv/bin/python -m scripts.mobile_realtime_smoke
```

In another terminal start a Metro separate from the usual environment:

```bash
cd mobile
API_URL=http://10.0.2.2:8002/api/v1 \
  npx expo start --dev-client --port 8082
```

On the Android Emulator, `10.0.2.2` resolves to the host for the API. For Metro it is more
stable to create the ADB reverse and open the dev client over loopback:

```bash
adb -s emulator-5554 reverse tcp:8082 tcp:8082
adb -s emulator-5554 shell am start -a android.intent.action.VIEW \
  -d 'exp+viajaya://expo-development-client/?url=http%3A%2F%2Flocalhost%3A8082'
adb -s emulator-5554 logcat -v time | rg '\[realtime\]'
```

Sign in with the ephemeral credentials the runner prints, grant
location while using the app and wait for `connected` +
`snapshot_applied`. Then run, one by one, the interactive commands:

```text
duplicate
gap
invalid_frame
quarantine
quit
```

The production hook must:

- discard a duplicate without repeating state or notices;
- detect a gap and apply a reconnection snapshot;
- recover from an invalid frame;
- receive the `1012` close after a confirmed quarantine and converge.

The scenarios must show respectively `dropped/duplicate`,
`resync/stream_gap`, `invalid_frame` followed by `resync/invalid_frame`, and
`closed` with code `1012` followed by `connected` and `snapshot_applied`.

`quit` cancels its own rides, sets the driver offline, removes only
the known artificial quarantine and shuts down the API. Then stop the temporary
Metro and the AVD, and return the disposable database to `base`. Do not interrupt the
usual backend, Metro or Redis.

The manual evidence must record commit, device or AVD, the state of
`/health/ready` and `/health/realtime`, the result per scenario and a sanitized
logcat excerpt. It must never keep JWTs, payloads, DSNs or personal data.

### Evidence 2026-07-23

- Source: `19a18da` plus the runner and tests documented in this delivery.
- Runtime: Expo SDK 56 dev build on `viajaya_pasajero`, Android 14.
- Isolated API: `live_local`, Alembic `0023`; `/health/ready=status=ok`,
  dispatcher and advisory lock healthy. `/health/realtime=status=ok`, without pending items
  or retries at the start.
- Duplicate: `dropped/duplicate`.
- Gap: `resync/stream_gap`; when the app came back to the foreground,
  `connected` + `snapshot_applied` was observed.
- Invalid frame: `invalid_frame` on sanitized metadata,
  `resync/invalid_frame`, local close, reconnection and snapshot.
- Quarantine: the dispatcher confirmed `invalid_payload`; the dev build received a
  `1012` close, reconnected and applied a snapshot.
- Cleanup: the runner's normal exit was verified with code `0`; the AVD and the
  `:8002`/`:8082` services were shut down and `test_viajaya` returned to `base`.

## Limits of the headless smoke

- It uses loopback without TLS, a reverse proxy or a load balancer.
- The base smoke certifies one `live_local` process; the Redis smoke certifies two
  processes only with shared presence and the durable scheduler active.
- It uses the Python `websockets` client, not React Native's native WebSocket.
- The dev build pass covers the native WebSocket and reconnection on an AVD, but not a
  real mobile network, TLS, prolonged suspension or network change.
- It injects duplicate, gap and quarantine only through the tests/runner one-shot
  harness. It forces `SIGKILL` and restart in `live_local|live_redis`, but does not
  cover a host or PostgreSQL crash.
- It certifies the durable recovery of offer expiry in the specific
  `scheduled_actions` PostgreSQL suite; this realtime smoke does not
  run that scenario again. Absence cancellation keeps its independent
  presence and grace mechanism documented in plan 0007.
