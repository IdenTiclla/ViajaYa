# ViajaYa realtime monitoring

With `OPENMETRICS_ENABLED=true`, the API exposes `/metrics` in OpenMetrics
1.0 format. The endpoint does not publish payloads, topics, DSNs or internal errors. In `off`
it reports only the configuration and the local counters; in `shadow`,
`live_local` or `live_redis` it adds the persisted outbox slice. In
`live_redis` it also exposes connection, reconnections, invalid messages, fanout and
number of local sockets, without publishing channels or payloads. If shared presence
is active, it adds health and counters for renewals, disconnections,
observations and failures; it never includes ride IDs or connection IDs.
When `SCHEDULED_ACTIONS_MODE=shadow|live`, the same document adds the scheduler's backlog,
leases, execution and retention; `/health/scheduled-actions` offers
the equivalent JSON slice for diagnostics. Shadow runs the worker in addition to the
legacy timer, so it should not accumulate `due` actions as normal behavior.

`prometheus.yml` wires the local scrape, the rules and Alertmanager. The job
starts with `viajaya-backend`, as the alerts expect. The Compose profile
exposes both interfaces only on loopback:

```bash
# The backend must publish /metrics before starting the profile.
OPENMETRICS_ENABLED=true

docker compose --profile monitoring up -d prometheus alertmanager

# Prometheus:   http://127.0.0.1:9090
# Alertmanager: http://127.0.0.1:9093
```

Inside Docker, `host.docker.internal:8000` reaches the development backend
running on the host. Staging and production must replace the target and
`external_labels.environment` with their real values.

The versioned Alertmanager uses a receiver without external outputs: it allows
checking grouping, resolution and silences from its interface without storing
credentials. For a real environment, mount a secret-managed file:

```bash
VIAJAYA_ALERTMANAGER_CONFIG_PATH=/secure/path/alertmanager.yml \
  docker compose --profile monitoring up -d alertmanager prometheus
```

That file must not live in the repository. It must configure the real receiver and
its escalation policy.

The common rules assume one Prometheus isolated per environment. If a single
instance monitors several ViajaYa jobs, each environment must copy and scope the
`absent(...)` rules to its `job` or environment label; a generic expression cannot
discover the name of a job that disappeared completely.

From the repository root, validate the full configuration with the same
versions pinned in CI:

```bash
docker run --rm --entrypoint /bin/promtool \
  -v "$PWD/ops/monitoring/prometheus:/etc/prometheus:ro" \
  prom/prometheus:v3.11.3 \
  check config /etc/prometheus/prometheus.yml

docker run --rm --entrypoint /bin/amtool \
  -v "$PWD/ops/monitoring/alertmanager:/etc/alertmanager:ro" \
  prom/alertmanager:v0.32.1 \
  check-config /etc/alertmanager/alertmanager.yml
```

The rules assume a scrape every 30–60 s. The thresholds of 120 s for
backlog, 10 s for publication and 10 min for retries are canary values:
they must be tuned with staging data before promoting each live mode.

`ViajaYaRealtimeNuevaCuarentena` uses the increase of a durable gauge because
quarantines are never pruned by retention. It can miss an increase
that happened during a long Prometheus outage; after recovering it, operations must
also review the persistent state in `/health/realtime`. The real Alertmanager
destinations are configured outside the repository so credentials are not versioned;
the versioned local configuration does not send notifications.

The deployment must restrict `/metrics` to Prometheus through ingress, firewall
or network policy. The flag prevents accidentally publishing the endpoint, but it does not
replace that perimeter control.

The backlog and quarantine metrics describe the same PostgreSQL from each
replica; the rules drop `instance`/`pod` so alerts are not duplicated. The
process signals (`up`, dispatcher and retention) do remain per instance.

The expected mode depends on the environment and is not encoded in the common rules.
Staging or production must add a rule on
`viajaya_realtime_outbox_info{mode="live_redis"}` when that phase is mandatory.

## Quick diagnosis

- Scrape or collection: query `/health/live`, `/health/ready`,
  `/health/realtime` and `/health/scheduled-actions`; confirm network, PostgreSQL and
  migrations `0018`–`0023`.
- Dispatcher or retention stopped: review readiness and the process's sanitized
  logs; do not restart another consumer until the advisory lock is confirmed.
- Redis disconnected or unstable: confirm `PING`, network and ACL. The process must
  stay out of readiness and close its sockets with 1012; do not force `published_at`
  because PostgreSQL keeps the batch for retry when the publish fails.
- Shared presence: confirm both Redis signals (bridge and store). During
  the outage and during a full grace period after recovering,
  `cancel_absent_ride` must be postponed without becoming `dead`.
- Backlog or retries: compare age, batches and last publish. Keep the
  pending rows for replay; do not mark them manually as published.
- Quarantine: record the code, identify the incompatible producer and force
  a new snapshot after fixing it. Retention does not delete the evidence.
- Slow publication: correlate the time of the last publication with
  PostgreSQL load. This gauge describes the last batch, not a percentile or an SLO.
- Scheduler: an aged `due` action indicates delayed execution; a
  `stale` lease must recover automatically. Do not delete `dead` actions: keep
  their sanitized code and fix the handler before rescheduling them. Automatic
  retention only removes `succeeded/cancelled` after the configured TTL. The
  critical alert watches new transitions to `dead` in a 10 min window and
  resolves when the incident stops; the `dead_persisted` gauge keeps the inventory.

Automating the receiver, silences and escalation belongs to the environment's
Alertmanager. There is no persisted acknowledgement for quarantines;
the runbook must check them after any Prometheus interruption.
