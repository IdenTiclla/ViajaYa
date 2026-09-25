# Durable real-time rollout

This sequence promotes the outbox, the scheduler, Redis and shared presence
without mixing incompatible consumers. Each mode change requires a controlled
deploy or restart of the environment; it is not changed dynamically on
existing processes.

## Preconditions

- PostgreSQL is at Alembic `0023_outbox_correlation_id`.
- All replicas run the same binary compatible with the v2 envelope,
  dual Redis publication and shared presence turned off.
- Mobile supports dual legacy/v2 reading and replay by watermarks.
- `/health/ready`, `/health/realtime` and `/health/scheduled-actions` are
  available only for sanitized diagnostics.
- Prometheus loads `ops/monitoring/prometheus/prometheus.yml`, the rules are
  active and Alertmanager receives their evaluations.

Never use `REALTIME_OUTBOX_DISPATCH_MODE=off` together with
`REALTIME_OUTBOX_RECORDING_ENABLED=true`: it would accumulate events that cannot
be safely replayed later.

## Stages

### 1. Baseline off

```text
REALTIME_OUTBOX_DISPATCH_MODE=off
REALTIME_OUTBOX_RECORDING_ENABLED=false
SCHEDULED_ACTIONS_MODE=off
REALTIME_SHARED_PRESENCE_ENABLED=false
```

Confirm migrations, readiness and the absence of pending rows created by a
previous activation. A historical quarantine is not deleted to pass the gate.

### 2. Shadow dispatcher without producers

```text
REALTIME_OUTBOX_DISPATCH_MODE=shadow
REALTIME_OUTBOX_RECORDING_ENABLED=false
SCHEDULED_ACTIONS_MODE=off
REALTIME_SHARED_PRESENCE_ENABLED=false
```

Certify advisory lock acquisition, lifecycle, coordinated shutdown and draining
of any previous backlog. The client keeps receiving only direct legacy
events.

### 3. Recording and shadow scheduler

```text
REALTIME_OUTBOX_DISPATCH_MODE=shadow
REALTIME_OUTBOX_RECORDING_ENABLED=true
SCHEDULED_ACTIONS_MODE=shadow
REALTIME_SHARED_PRESENCE_ENABLED=false
```

Run a full negotiation and compare the types, cardinality, order and
correlation of the batches against the versioned contract. The outbox must
converge to zero pending without persistent retries or new quarantines. The
durable scheduler competes idempotently with the legacy timers.

### 4. Local canary

```text
REALTIME_OUTBOX_DISPATCH_MODE=live_local
REALTIME_OUTBOX_RECORDING_ENABLED=true
SCHEDULED_ACTIONS_MODE=live
REALTIME_SHARED_PRESENCE_ENABLED=false
```

Use exactly one API worker. Certify v2 snapshots, watermarks, durable
expiry, `1012` close, redelivery and convergence through polling before continuing.

### 5. Redis with one worker

```text
REALTIME_OUTBOX_DISPATCH_MODE=live_redis
REALTIME_OUTBOX_RECORDING_ENABLED=true
SCHEDULED_ACTIONS_MODE=live
REALTIME_SHARED_PRESENCE_ENABLED=false
```

Check a confirmed subscriber, publish/retry, readiness during a Redis
outage and replay after recovering it. The advisory lock must reject a
second replica while presence remains local.

### 6. Shared presence and several replicas

After deploying the compatible binary with the flag off on all
replicas:

```text
REALTIME_OUTBOX_DISPATCH_MODE=live_redis
REALTIME_OUTBOX_RECORDING_ENABLED=true
SCHEDULED_ACTIONS_MODE=live
REALTIME_SHARED_PRESENCE_ENABLED=true
```

First promote two workers in staging. Passenger and driver must connect to
different processes and complete creation, offer, acceptance, progress and closure.
Redis down or just recovered must postpone `cancel_absent_ride`, never
confirm it on doubt.

## Sanitized gates

Before each stage:

- `/health/ready` returns `status=ok`;
- `/health/realtime` shows no aged pending items, persistent retries or
  new quarantines;
- `/health/scheduled-actions` shows no overdue actions, stuck leases or
  new `dead` actions;
- Prometheus keeps `up=1` and Alertmanager holds no active critical alerts;
- no repeated resyncs or invalid frames appear in the mobile observer.

Record commit, time, previous/new mode, number of replicas, gate results
and the decision to continue or roll back. Do not store DSNs, JWTs, payloads, ride
IDs or presence members.

## Rollback

- Before `live`: go back to the previous stage with the same data; do not revert
  migrations or delete outbox or scheduler rows.
- From multi-worker `live_redis`: first reduce to one worker and turn off shared
  presence; then go back to `live_local` or `shadow`.
- A quarantine or pending batch is kept for diagnosis and replay. Never
  set `published_at` manually.
- Keep mobile polling throughout the rollout as a convergence path.
