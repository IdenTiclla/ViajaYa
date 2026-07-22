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

El pase headless no sustituye el runtime React Native. Para cerrar la
certificación móvil todavía se debe añadir un observador técnico sanitizado que
conserve código de cierre, causa de descarte y motivo de resync. Después se debe
usar un dev build —nunca Expo Go— y observar que el hook productivo:

- descarta un duplicado sin repetir estado ni avisos;
- detecta un hueco y aplica un snapshot de reconexión;
- se recupera de un frame inválido;
- recibe el cierre `1012` posterior a una cuarentena confirmada y converge.

Ese pase requiere un emulador o dispositivo solicitado expresamente. El arnés
one-shot de los tests puede reutilizarse al diseñar el proxy o runner móvil, pero
no se deben añadir endpoints administrativos ni flags de corrupción al artefacto
productivo.

La evidencia manual debe registrar commit, dispositivo o AVD, estado de
`/health/ready` y `/health/realtime`, resultado por escenario y un extracto
sanitizado de logcat. Nunca debe conservar JWT, payloads, DSN ni datos personales.

## Límites del smoke headless

- Usa loopback sin TLS, proxy inverso ni balanceador.
- Certifica un único proceso `live_local` con hub en memoria, no multiworker.
- Usa el cliente Python `websockets`, no el WebSocket nativo de React Native.
- Cierra y abre explícitamente otra conexión; no prueba backoff, AppState ni red
  móvil.
- Inyecta duplicado, hueco y cuarentena solo mediante el arnés one-shot de
  tests. Fuerza `SIGKILL` y restart de un único proceso `live_local`, pero no
  cubre caída del host o PostgreSQL, Redis, multiworker, frame inválido ni el
  hook React Native.
- No certifica que la expiración de ofertas ni la cancelación por ausencia
  sobrevivan al restart; esos timers siguen en memoria hasta implementar
  `scheduled_actions` durable.
