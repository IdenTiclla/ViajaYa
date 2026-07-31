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
VIAJAYA_TEST_REDIS_URL=redis://localhost:6379/15 \
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

Los casos `live_local` no requieren Redis. Las variantes de crash
`live_redis` se omiten si `VIAJAYA_TEST_REDIS_URL` no está definida; al
habilitarlas usan un canal aleatorio y no escriben estado durable en Redis.
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
de `SIGKILL`; en otros sistemas la prueba se omite. Cada caso se ejecuta primero
en `live_local` y después en `live_redis`. La segunda variante usa el bridge,
Pub/Sub y suscripción reales sobre un canal aislado.

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
`off` aislado intenta limpiar ese estado sin ocultar el error primario. El
2026-07-23 pasaron las cuatro combinaciones de ventana y transporte.

## Pase del dev build React Native

El pase headless no sustituye el runtime React Native. El observador técnico de
desarrollo conserva en un buffer acotado y escribe con el prefijo `[realtime]`
el código de cierre, la causa de descarte y el motivo de resync. Solo registra
scope `passenger|driver`, categorías cerradas, secuencia y hora; nunca rutas,
IDs de viaje, tokens, frames ni payloads. El buffer está deshabilitado fuera de
`__DEV__`.

El runner `scripts/mobile_realtime_smoke.py` permite repetir el pase con un dev
build —nunca Expo Go— sin agregar controles al artefacto productivo. Arranca una
API `live_local` sobre una base PostgreSQL desechable, crea una cuenta efímera de
conductor y arma los fallos únicamente por referencia directa dentro del
proceso.

Primero lleva la base desechable a `head` y arranca el runner:

```bash
cd backend
DATABASE_URL="$VIAJAYA_TEST_DATABASE_URL" .venv/bin/alembic upgrade head
.venv/bin/python -m scripts.mobile_realtime_smoke
```

En otra terminal levanta un Metro separado del entorno habitual:

```bash
cd mobile
API_URL=http://10.0.2.2:8002/api/v1 \
  npx expo start --dev-client --port 8082
```

En Android Emulator, `10.0.2.2` resuelve al host para la API. Para Metro es más
estable crear el reverse ADB y abrir el dev client por loopback:

```bash
adb -s emulator-5554 reverse tcp:8082 tcp:8082
adb -s emulator-5554 shell am start -a android.intent.action.VIEW \
  -d 'exp+viajaya://expo-development-client/?url=http%3A%2F%2Flocalhost%3A8082'
adb -s emulator-5554 logcat -v time | rg '\[realtime\]'
```

Inicia sesión con las credenciales efímeras que imprime el runner, concede la
ubicación mientras se usa la app y espera `connected` +
`snapshot_applied`. Luego ejecuta, uno por uno, los comandos interactivos:

```text
duplicate
gap
invalid_frame
quarantine
quit
```

El hook productivo debe:

- descartar un duplicado sin repetir estado ni avisos;
- detectar un hueco y aplicar un snapshot de reconexión;
- recuperarse de un frame inválido;
- recibir el cierre `1012` posterior a una cuarentena confirmada y converger.

Los escenarios deben mostrar respectivamente `dropped/duplicate`,
`resync/stream_gap`, `invalid_frame` seguido de `resync/invalid_frame`, y
`closed` con código `1012` seguido de `connected` y `snapshot_applied`.

`quit` cancela los rides propios, deja al conductor offline, retira únicamente
la cuarentena artificial conocida y apaga la API. Después detén el Metro
temporal y el AVD, y devuelve la base desechable a `base`. No interrumpas el
backend, Metro o Redis habituales.

La evidencia manual debe registrar commit, dispositivo o AVD, estado de
`/health/ready` y `/health/realtime`, resultado por escenario y un extracto
sanitizado de logcat. Nunca debe conservar JWT, payloads, DSN ni datos personales.

### Evidencia 2026-07-23

- Fuente: `19a18da` más el runner y pruebas documentados en esta entrega.
- Runtime: dev build Expo SDK 56 sobre `viajaya_pasajero`, Android 14.
- API aislada: `live_local`, Alembic `0023`; `/health/ready=status=ok`,
  dispatcher y advisory lock sanos. `/health/realtime=status=ok`, sin pendientes
  ni retries al comenzar.
- Duplicado: `dropped/duplicate`.
- Hueco: `resync/stream_gap`; al volver la app a primer plano se observó
  `connected` + `snapshot_applied`.
- Frame inválido: `invalid_frame` sobre metadatos sanitizados,
  `resync/invalid_frame`, cierre local, reconexión y snapshot.
- Cuarentena: el dispatcher confirmó `invalid_payload`; el dev build recibió
  cierre `1012`, reconectó y aplicó snapshot.
- Limpieza: el cierre normal del runner se verificó con código `0`; el AVD y los
  servicios `:8002`/`:8082` se apagaron y `test_viajaya` volvió a `base`.

## Límites del smoke headless

- Usa loopback sin TLS, proxy inverso ni balanceador.
- El smoke base certifica un proceso `live_local`; el smoke Redis certifica dos
  procesos únicamente con presencia compartida y scheduler durable activos.
- Usa el cliente Python `websockets`, no el WebSocket nativo de React Native.
- El pase de dev build cubre el WebSocket nativo y reconexión en AVD, pero no una
  red móvil real, TLS, suspensión prolongada ni cambio de red.
- Inyecta duplicado, hueco y cuarentena solo mediante el arnés one-shot de
  tests/runner. Fuerza `SIGKILL` y restart en `live_local|live_redis`, pero no
  cubre caída del host o PostgreSQL.
- Certifica la recuperación durable de expiración de ofertas en la suite
  PostgreSQL específica de `scheduled_actions`; este smoke de realtime no
  vuelve a ejecutar ese escenario. La cancelación por ausencia conserva su
  mecanismo independiente de presencia y gracia documentado en el plan 0007.
