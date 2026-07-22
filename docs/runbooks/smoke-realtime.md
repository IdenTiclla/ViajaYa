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
  tests/postgresql/test_pg_realtime_fault_smoke.py -q
```

La guarda compartida de la suite rechaza drivers distintos de
`postgresql+asyncpg` y bases cuyo nombre no empiece por `test_` ni termine en
`_test`. La fixture ejecuta `downgrade base → upgrade head → downgrade base`, por
lo que elimina todos los objetos administrados por Alembic en la base indicada.
Nunca apuntes esta variable a desarrollo, staging o producción.

La prueba usa usuarios con sufijo aleatorio, un puerto loopback efímero y
deadlines acotados. En el `finally` verifica que el ride se cancele, deja al
conductor offline, espera que la outbox drene y apaga Uvicorn junto con sus
timers de presencia/expiración. La limpieza física ocurre al desmontar la
fixture PostgreSQL de la suite. No registra JWT, payloads ni la URL de base de
datos.

Este smoke forma parte del job `Backend · PostgreSQL real` de CI porque vive en
`tests/postgresql/`; no requiere cuentas seed ni un backend levantado de
antemano.

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
  tests. Todavía no fuerza crash/restart del proceso, no inyecta un frame
  inválido y no ejecuta el hook React Native.
