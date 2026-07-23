# Rollout del tiempo real durable

Esta secuencia promueve la outbox, el scheduler, Redis y la presencia compartida
sin mezclar consumidores incompatibles. Cada cambio de modo requiere un
despliegue o reinicio controlado del entorno; no se cambia dinámicamente sobre
procesos existentes.

## Precondiciones

- PostgreSQL está en Alembic `0023_outbox_correlation_id`.
- Todas las réplicas ejecutan el mismo binario compatible con envelope v2,
  publicación Redis dual y presencia compartida apagada.
- Mobile soporta lectura dual legacy/v2 y replay por watermarks.
- `/health/ready`, `/health/realtime` y `/health/scheduled-actions` están
  disponibles solo para diagnóstico sanitario.
- Prometheus carga `ops/monitoring/prometheus/prometheus.yml`, las reglas están
  activas y Alertmanager recibe sus evaluaciones.

Nunca uses `REALTIME_OUTBOX_DISPATCH_MODE=off` junto con
`REALTIME_OUTBOX_RECORDING_ENABLED=true`: acumularía eventos que no pueden
reproducirse después con seguridad.

## Etapas

### 1. Base apagada

```text
REALTIME_OUTBOX_DISPATCH_MODE=off
REALTIME_OUTBOX_RECORDING_ENABLED=false
SCHEDULED_ACTIONS_MODE=off
REALTIME_SHARED_PRESENCE_ENABLED=false
```

Confirma migraciones, readiness y ausencia de filas pendientes creadas por una
activación anterior. Una cuarentena histórica no se borra para superar el gate.

### 2. Dispatcher sombra sin productores

```text
REALTIME_OUTBOX_DISPATCH_MODE=shadow
REALTIME_OUTBOX_RECORDING_ENABLED=false
SCHEDULED_ACTIONS_MODE=off
REALTIME_SHARED_PRESENCE_ENABLED=false
```

Certifica adquisición del advisory lock, lifecycle, apagado coordinado y drenado
de cualquier backlog previo. El cliente continúa recibiendo únicamente eventos
legacy directos.

### 3. Grabación y scheduler sombra

```text
REALTIME_OUTBOX_DISPATCH_MODE=shadow
REALTIME_OUTBOX_RECORDING_ENABLED=true
SCHEDULED_ACTIONS_MODE=shadow
REALTIME_SHARED_PRESENCE_ENABLED=false
```

Ejecuta una negociación completa y compara tipos, cardinalidad, orden y
correlación de los batches contra el contrato versionado. La outbox debe
converger a cero pendientes sin retries persistentes ni nuevas cuarentenas. El
scheduler durable compite idempotentemente con los timers legacy.

### 4. Canary local

```text
REALTIME_OUTBOX_DISPATCH_MODE=live_local
REALTIME_OUTBOX_RECORDING_ENABLED=true
SCHEDULED_ACTIONS_MODE=live
REALTIME_SHARED_PRESENCE_ENABLED=false
```

Usa exactamente un worker API. Certifica snapshots v2, watermarks, expiración
durable, cierre `1012`, reentrega y convergencia por polling antes de continuar.

### 5. Redis con un worker

```text
REALTIME_OUTBOX_DISPATCH_MODE=live_redis
REALTIME_OUTBOX_RECORDING_ENABLED=true
SCHEDULED_ACTIONS_MODE=live
REALTIME_SHARED_PRESENCE_ENABLED=false
```

Comprueba suscriptor confirmado, publish/retry, readiness durante una caída de
Redis y replay después de recuperarlo. El advisory lock debe rechazar una
segunda réplica mientras la presencia siga local.

### 6. Presencia compartida y varias réplicas

Después de desplegar el binario compatible con el flag apagado en todas las
réplicas:

```text
REALTIME_OUTBOX_DISPATCH_MODE=live_redis
REALTIME_OUTBOX_RECORDING_ENABLED=true
SCHEDULED_ACTIONS_MODE=live
REALTIME_SHARED_PRESENCE_ENABLED=true
```

Promueve primero dos workers en staging. Pasajero y conductor deben conectarse a
procesos distintos y completar creación, oferta, aceptación, avance y cierre.
Redis caído o recién recuperado debe aplazar `cancel_absent_ride`, nunca
confirmarlo por duda.

## Gates sanitarios

Antes de cada etapa:

- `/health/ready` responde `status=ok`;
- `/health/realtime` no muestra pendientes envejecidos, retries persistentes ni
  nuevas cuarentenas;
- `/health/scheduled-actions` no muestra acciones vencidas, leases estancados ni
  nuevas acciones `dead`;
- Prometheus mantiene `up=1` y Alertmanager no conserva alertas críticas activas;
- no aparecen resyncs repetidos ni frames inválidos en el observador mobile.

Registra commit, hora, modo anterior/nuevo, número de réplicas, resultado de los
gates y decisión de continuar o revertir. No guardes DSN, JWT, payloads, IDs de
ride ni miembros de presencia.

## Rollback

- Antes de `live`: vuelve a la etapa previa con los mismos datos; no reviertas
  migraciones ni elimines filas de outbox o scheduler.
- Desde `live_redis` multiworker: reduce primero a un worker y apaga presencia
  compartida; después vuelve a `live_local` o `shadow`.
- Una cuarentena o batch pendiente se conserva para diagnóstico y replay. Nunca
  marques `published_at` manualmente.
- Mantén el polling mobile durante todo el rollout como vía de convergencia.
