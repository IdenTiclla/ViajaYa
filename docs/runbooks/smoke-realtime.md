# Smoke realtime

El smoke headless certifica la vertical canary de un solo proceso con componentes
reales: PostgreSQL en `head`, Uvicorn sobre TCP, HTTP, autenticación por Bearer y
WebSocket con los subprotocolos `viajaya.auth` + token. Ejecuta el modo
`live_local` con grabación durable, recibe un snapshot v2, provoca un delta y
comprueba que una conexión nueva converge mediante otro snapshot autoritativo.

## Ejecución headless

Define `VIAJAYA_TEST_DATABASE_URL` con una base PostgreSQL desechable y ejecuta:

```bash
cd backend
.venv/bin/pytest \
  tests/postgresql/test_pg_realtime_network_smoke.py \
  tests/postgresql/test_pg_realtime_fault_smoke.py \
  tests/postgresql/test_pg_realtime_crash_smoke.py -q
```

La guarda compartida de la suite rechaza drivers distintos de
`postgresql+asyncpg` y bases cuyo nombre no empiece por `test_` ni termine en
`_test`. La fixture ejecuta `downgrade base → upgrade head → downgrade base`, por
lo que elimina todos los objetos administrados por Alembic en la base indicada.
Nunca apuntes esta variable a desarrollo, staging o producción.

Los smokes base y one-shot usan usuarios con sufijo aleatorio, un puerto loopback
efímero y deadlines acotados. En su `finally` verifican que el ride se cancele,
dejan al conductor offline, esperan que la outbox drene y apagan Uvicorn junto
con sus timers de presencia/expiración. La limpieza física ocurre al desmontar
la fixture PostgreSQL de la suite. No registran JWT, payloads ni la URL de base
de datos.

Este smoke forma parte del job `Backend · PostgreSQL real` de CI porque vive en
`tests/postgresql/`; no requiere cuentas seed ni un backend levantado de
antemano.

## Bridge Redis

El mismo job levanta Redis y define `VIAJAYA_TEST_REDIS_URL`. La prueba
`test_pg_redis_realtime_bridge.py` abre dos clientes y dos hubs locales sobre un
canal aleatorio, publica un envelope durable y exige la misma identidad en ambos
procesos simulados. Después mata las conexiones Pub/Sub, exige cierre 1012 de los
sockets y espera la reconexión de ambos bridges.

`test_pg_redis_multiworker_smoke.py` conserva dos gates. Sin el flag compartido,
un segundo Uvicorn debe fallar. Con `REALTIME_SHARED_PRESENCE_ENABLED=true` y el
scheduler live, levanta dos procesos contra la misma PostgreSQL/Redis: el
pasajero conecta al primero, el conductor al segundo, ambos reciben snapshots y
la negociación `ride_created → offer_created → offer_accepted` cruza procesos.
`test_pg_shared_passenger_presence.py` certifica además los scripts Lua, leases
por conexión, gracia y `cancel_absent_ride` con fencing durable.
Los tests rápidos verifican que la creación del ride persiste la primera acción
de ausencia en la misma UoW y que el reconciliador repara búsquedas legacy de
forma idempotente antes de habilitar múltiples workers.

Cada respuesta HTTP incluye `X-Request-ID`. Para seguir una mutación hasta el
cliente, busca ese UUID en el log sanitizado del request, en
`realtime_outbox.correlation_id` y en `correlation_id` del envelope v2. Las
acciones del scheduler usan su propio `scheduled_actions.id` como correlación.
No uses JWT, query strings ni payloads como identificadores de diagnóstico.
Durante un rolling deploy, los eventos creados o entregados por una réplica
anterior usan `batch_id` como fallback estable. El bridge nuevo publica además
una copia legacy en `REALTIME_REDIS_CHANNEL`; confirma que no haya resyncs por
schema antes de retirar la compatibilidad en una fase futura.

`test_pg_redis_restart_smoke.py` usa exclusivamente el servicio con perfil
`redis_restart_test`: detiene Redis después del commit y antes del publish,
comprueba el cierre 1012 y el retry pendiente, levanta el mismo contenedor y
exige replay con idénticos `event_id`, `batch_id`, secuencia y versión. Rechaza
URLs no loopback, bases distintas de 15 y contenedores sin marca `test|ci`.
Localmente:

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

Estas pruebas certifican transporte, restart/replay y la promoción condicionada
a multiworker; complementan los casos unitarios de leases, mensaje inválido y
ausencia de suscriptores.
El Redis normal de desarrollo/CI no se interrumpe durante el restart smoke.

## Crash/restart multiproceso

El smoke de crash usa dos procesos Uvicorn consecutivos, el mismo socket
loopback, la misma PostgreSQL y el mismo secreto JWT fijo de prueba. Las
compuertas son objetos IPC anónimos del runner; no existen endpoints, variables
de corrupción ni controles remotos en `app`. Requiere POSIX por el uso explícito
de `SIGKILL`; en otros sistemas la prueba se omite.

Certifica separadamente estas dos ventanas:

- `commit → publish`: el primer proceso queda suspendido antes de emitir y
  recibe `SIGKILL`; el claim revierte, la fila sigue pendiente y la segunda
  instancia publica con el hub vacío. Una conexión posterior converge por su
  snapshot y watermark sin depender de haber recibido ese delta.
- `publish → published_at`: el primer socket recibe el frame y el proceso muere
  antes de confirmar; la segunda instancia reentrega exactamente el mismo
  `event_id`, `batch_id`, secuencia, versión y payload.

En ambos casos se comprueba salida por `SIGKILL`, cierre WebSocket anormal,
liberación y readquisición del advisory lock, `attempts == 0` después del crash,
`attempts == 1` y `published_at` confirmado después del replay, además de un
snapshot nuevo con una sola oferta y watermark exacto. En la ventana posterior a
publicación, el proceso de recuperación se detiene antes del replay únicamente
dentro del arnés para permitir que el socket TCP real observe la reentrega.
En el camino exitoso también verifica cancelación, conductor offline, drenado y
shutdown coordinado de la instancia recuperada. Si una aserción ya falló, un app
`off` aislado intenta limpiar ese estado sin ocultar el error primario.

## Cobertura todavía manual

El pase headless no sustituye el runtime React Native. El observador técnico de
desarrollo conserva en un buffer acotado y escribe con el prefijo `[realtime]`
el código de cierre, la causa de descarte y el motivo de resync. Solo registra
scope `passenger|driver`, categorías cerradas, secuencia y hora; nunca rutas,
IDs de viaje, tokens, frames ni payloads. El buffer está deshabilitado fuera de
`__DEV__`.

Para cerrar la certificación se debe usar un dev build —nunca Expo Go— y
observar que el hook productivo:

- descarta un duplicado sin repetir estado ni avisos;
- detecta un hueco y aplica un snapshot de reconexión;
- se recupera de un frame inválido;
- recibe el cierre `1012` posterior a una cuarentena confirmada y converge.

La evidencia puede capturarse desde Metro o, en Android, filtrando logcat:

```bash
adb logcat -v time | rg '\[realtime\]'
```

Los escenarios deben mostrar respectivamente `dropped/duplicate`,
`resync/stream_gap`, `invalid_frame` seguido de `resync/invalid_frame`, y
`closed` con código `1012` seguido de `connected` y `snapshot_applied`.

Ese pase requiere un emulador o dispositivo solicitado expresamente. El arnés
one-shot de los tests puede reutilizarse al diseñar el proxy o runner móvil, pero
no se deben añadir endpoints administrativos ni flags de corrupción al artefacto
productivo.

La evidencia manual debe registrar commit, dispositivo o AVD, estado de
`/health/ready` y `/health/realtime`, resultado por escenario y un extracto
sanitizado de logcat. Nunca debe conservar JWT, payloads, DSN ni datos personales.

## Límites del smoke headless

- Usa loopback sin TLS, proxy inverso ni balanceador.
- El smoke base certifica un proceso `live_local`; el smoke Redis certifica dos
  procesos únicamente con presencia compartida y scheduler durable activos.
- Usa el cliente Python `websockets`, no el WebSocket nativo de React Native.
- Cierra y abre explícitamente otra conexión; no prueba backoff, AppState ni red
  móvil.
- Inyecta duplicado, hueco y cuarentena solo mediante el arnés one-shot de
  tests. Fuerza `SIGKILL` y restart de un único proceso `live_local`, pero no
  cubre caída del host o PostgreSQL, crash API durante `live_redis`, frame
  inválido por TCP ni el hook React Native.
- Certifica la recuperación durable de expiración de ofertas en la suite
  PostgreSQL específica de `scheduled_actions`; este smoke de realtime no
  vuelve a ejecutar ese escenario. La cancelación por ausencia conserva su
  mecanismo independiente de presencia y gracia documentado en el plan 0007.
