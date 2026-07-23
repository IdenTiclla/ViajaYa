# ViajaYa — Backend (FastAPI + Clean Architecture)

API de taxis y encomiendas. Python 3.11+, FastAPI async, SQLAlchemy 2.0 async sobre
PostgreSQL, autenticación JWT y SSO (Google/Facebook), tiempo real por WebSocket.

## Arquitectura (Clean Architecture)

Las dependencias apuntan siempre **hacia adentro**: `api → application → domain`.
La infraestructura implementa interfaces del dominio/aplicación y se cablea en `api/deps.py`.

```
app/
├── domain/                  # Núcleo. SIN dependencias de framework.
│   ├── entities.py            # User, RideRequest, Offer, RideRating, SavedPlace + enums
│   │                          #   (AuthProvider, UserRole, VehicleType, ServiceType, PaymentMethod,
│   │                          #    RideStatus, OfferStatus, SavedPlaceCategory)
│   ├── value_objects.py       # Email, RawPassword, GeoPoint, FareOffer (frozen, slots)
│   ├── repositories.py        # Interfaces (puertos): User, RideRequest, Offer, Rating, SavedPlace
│   ├── ride_policy.py         # OFFER_TTL=30s + offer_expires_at / is_offer_expired / is_offer_active
│   └── exceptions.py          # DomainError + 16 excepciones específicas
├── application/             # Casos de uso. Orquestan el dominio.
│   ├── use_cases/             # UN caso de uso por archivo · 36 UC (lista abajo)
│   ├── interfaces.py          # Puertos técnicos y proyecciones de lectura de aplicación
│   ├── dto.py                 # @dataclass(frozen=True) de entrada/salida entre capas
│   └── token_issuer.py        # Helper issue_token_pair(tokens, user_id)  (NO es una clase)
├── infrastructure/          # Adaptadores concretos.
│   ├── config.py              # Settings (pydantic-settings). ÚNICA fuente de verdad de config.
│   ├── db/                    # SQLAlchemy: models, repos, UnitOfWork y outbox durable
│   ├── security/              # bcrypt_hasher, jwt_service
│   ├── oauth/                 # google_verifier, facebook_verifier
│   └── realtime/              # hub local, dispatcher y coordinación de transporte
└── api/                     # Capa HTTP (FastAPI).
    ├── deps.py                # Inyección: ÚNICO cableo infra→app (factories get_*, *Dep)
    ├── errors.py              # DomainError → HTTP (map _STATUS_MAP, sin HTTPException disperso)
    ├── health.py              # Liveness, readiness y snapshot sanitario de outbox
    └── v1/
        ├── routers/            # auth, rides, drivers, saved_places
        ├── schemas/            # Pydantic v2 request/response (NO reusar entities)
        ├── events.py           # Publicadores WS (RIDE_CREATED, OFFER_EXPIRED, …) vía hub
        ├── presence.py         # Presencia del pasajero con ventana de gracia (120 s)
        └── ws/negotiation.py   # Endpoints WebSocket (/ws/driver, /ws/rides/{ride_id})
```

### Reglas al añadir código

- **El dominio no importa nada de `application`, `infrastructure` ni `api`.** Si una entidad
  necesita un servicio externo, defínelo como interfaz (puerto) y recibe la implementación por inyección.
- **Un caso de uso por archivo** en `application/use_cases/`, con método **`async def execute(...)`**
  (no `__call__`). Factory `get_*` en `api/deps.py` que devuelve la instancia cableada.
- **Toda construcción de objetos vive en `api/deps.py`.** Se exponen como `Annotated[T, Depends(...)]`
  (`CurrentUserDep`, `SessionDep`, `*RepositoryDep`). No instancies repos/servicios en los routers.
- **Los routers solo traducen HTTP↔caso de uso.** Reciben schemas Pydantic, llaman al UC inyectado,
  devuelven `response_model` y publican eventos vía `app.api.v1.events`. Sin lógica de negocio.
- **Schemas (`api/v1/schemas/`) ≠ entities.** Nunca expongas entidades del dominio directamente;
  usa helpers `XResponse.from_detail(...)`.
- **Errores:** lanza `DomainError` desde los UC; se mapea a HTTP en `api/errors.py`. Única excepción:
  `unauthorized()` para auth. Nunca `HTTPException` disperso.
- **Policy de oferta** (TTL, expiración) vive en `domain/ride_policy.py`, no en UC ni entidades.
- **Lecturas enriquecidas:** `RideReadRepository` evita exponer ORM y cargas N+1.
  Ganancias usa un agregado SQL para totales/conteos y otra consulta limitada a
  los últimos 10 viajes; aplicación delimita el día en `America/La_Paz`.
- **Transacciones migradas a outbox:** el repositorio hace `flush`, el caso de
  uso registra el batch y `UnitOfWork` decide el único `commit`. No conviertas
  otros repositorios mecánicamente: migra todos los call sites de una operación
  en el mismo cambio. `CreateOffer`, `AcceptOffer`, `PauseRideForEdit`,
  `CancelRide`, `CancelRideOnDisconnect`, `UpdateRideFare`, `EditRide`,
  `AnnounceOpenRide`, `WithdrawOffer`, `RejectOffer`, `ExpireOffer` y
  `UpdateRideStatus`, además de `SetDriverOnline` para ambos sentidos, ya usan
  este flujo;
  `CreateRideRequest` delega el commit al UoW, pero no anuncia hasta que se
  confirma presencia.

### Patrón para añadir un endpoint

1. Entidad/value object en `domain/` (si aplica).
2. Método en el repositorio abstracto + implementación `SqlAlchemy*` en `infrastructure/db/`.
3. UC `async def execute` en `application/use_cases/`.
4. DTO en `application/dto.py` (si hay datos compuestos de entrada/salida).
5. Schema Pydantic en `api/v1/schemas/`.
6. Factory `get_*` en `api/deps.py`.
7. Endpoint en `api/v1/routers/` que traduce HTTP↔UC y publica eventos vía `app.api.v1.events`.
8. Migración Alembic si toca el esquema.
9. Test unitario (UC con dobles) y/o e2e (API).

## Comandos

```bash
cd backend
source .venv/bin/activate         # entorno virtual (o usa uv; ver nota en el README del monorepo)

# Levantar PostgreSQL + Redis (desde la raíz del repo)
docker compose up -d db redis

# Migraciones (Alembic)
alembic upgrade head              # aplicar
alembic revision -m "mensaje"     # nueva migración (REVISAR EL AUTOGENERADO A MANO)

# Servidor de desarrollo
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
# Swagger: http://localhost:8000/docs   ·   Health: GET /health

# Tests (no hay configuración de coverage todavía)
pytest                            # todo
pytest tests/unit                 # solo unitarios (UC con fakes)
pytest tests/e2e                  # API end-to-end (httpx + aiosqlite)
pytest tests/e2e/test_negotiation_ws.py   # flujo WS de negociación

# Calidad
ruff check .                      # lint (E,F,I,UP,B,C4 · line-length=100)
ruff check --fix . && ruff format .
```

## Configuración

`infrastructure/config.py` (`Settings`) lee de `.env` (ver `.env.example`). Variables clave:

```
DATABASE_URL=postgresql+asyncpg://viajaya:viajaya@localhost:5432/viajaya
JWT_SECRET, JWT_ALGORITHM (HS256),
ACCESS_TOKEN_EXPIRE_MINUTES (30), REFRESH_TOKEN_EXPIRE_DAYS (14),
CORS_ORIGINS (lista separada por comas; helper .cors_origins_list),
GOOGLE_CLIENT_ID, FACEBOOK_APP_ID, FACEBOOK_APP_SECRET,
OPENMETRICS_ENABLED (false por defecto; publica `/metrics` solo con opt-in),
REALTIME_OUTBOX_DISPATCH_MODE (off|shadow|live_local|live_redis; off por defecto),
REALTIME_OUTBOX_RECORDING_ENABLED (false por defecto),
REALTIME_OUTBOX_POLL_INTERVAL_SECONDS (1),
REALTIME_OUTBOX_RETRY_BASE_SECONDS (1),
REALTIME_OUTBOX_RETRY_MAX_SECONDS (60),
REALTIME_OUTBOX_SHUTDOWN_TIMEOUT_SECONDS (5),
REALTIME_OUTBOX_PUBLISHED_RETENTION_DAYS (0, desactivada),
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
SCHEDULED_ACTIONS_MODE (off|shadow|live; off por defecto),
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

Accede a la config con `get_settings()` (cacheado con `@lru_cache`); **no leas `os.environ` directo**.
CORS se aplica en `main.py` con `cors_origins_list`.

El rollout de la outbox sigue obligatoriamente esta secuencia: `off+false` ->
`shadow+false` -> `shadow+true` -> `live_local+true` -> `live_redis+true`. No
uses `off+true` ni actives un modo live sin drenar y revisar antes el backlog
sombra. Antes de salir
de `off` deben estar aplicadas `0018_realtime_outbox`,
`0019_realtime_stream_versions`, `0020_realtime_outbox_quarantine` y
`0021_realtime_outbox_batch_size`. `shadow`
reclama, valida y marca batches, pero no los entrega. `live_local` pre-serializa
el batch completo como envelopes v2, lo envía en orden al hub del proceso y solo
después marca `published_at`; simultáneamente desactiva la entrega directa legacy
y usa los snapshots unificados v2. Una cuarentena live cierra con 1012 los
sockets de sus streams después del commit para forzar otro snapshot.

`live_local` es exclusivamente una vertical canary de **un solo worker API**.
`live_redis` publica el batch v2 completo en Redis y cada proceso mantiene un
suscriptor que lo entrega solo a sus sockets locales. Pub/Sub es efímero: perder
la suscripción cierra todos los sockets locales con 1012 para que el nuevo
handshake recupere snapshot y watermarks desde PostgreSQL. Mientras Redis no
está sano, los timers locales aplazan la cancelación por ausencia. Un publish sin
ningún suscriptor falla y conserva el batch para retry; un batch que supera el
límite de bytes se aparta con `transport_limit` y fuerza snapshot en vez de
reintentarse para siempre. Los advisory locks conservan la clave legada durante
rolling deploy: varios `shadow` pueden convivir, `live_local` siempre es
exclusivo y `live_redis` solo comparte el lock cuando
`REALTIME_SHARED_PRESENCE_ENABLED=true`. El flag exige scheduler `live`; apagado,
el segundo proceso sigue fallando. La promoción se hace después de desplegar el
binario con el flag apagado en todas las réplicas. Perder la sesión propietaria
detiene el dispatcher. SQLite omite esta exclusión solo en pruebas. Otro smoke detiene un Redis dedicado
entre commit y publish, exige cierre 1012 y certifica el replay de la misma
identidad durable después del restart.

La migración `0022_scheduled_actions` debe aplicarse antes de desplegar el código
que crea ofertas. La acción `expire_offer` se persiste en los tres modos. `off`
mantiene el timer local sin consumir la cola; `shadow` ejecuta simultáneamente el
worker durable y el timer, conservando la entrega legacy para quien gane la
carrera; `live` retira el timer y depende de la outbox
`live_local|live_redis`. Así, los
reinicios y los cambios de modo no dejan ofertas sin recuperación ni acumulan un
backlog antes del cutover. El arranque y cada ciclo consumidor reconcilian por
lotes cualquier oferta que la versión anterior haya creado después del backfill
de la migración. Deadlines, leases, backoff y la revalidación atómica al aceptar
usan el reloj de PostgreSQL.
Las acciones `succeeded/cancelled` se purgan por lotes después de 30 días; las
acciones `dead` se conservan para intervención manual.

La presencia compartida usa un sorted set Redis por ride y miembros separados
`ws:{connection_id}`/`http`; Lua poda y evalúa leases con `Redis TIME` sin que
una desconexión borre otra conexión. Cada renovación hace upsert generacional de
`cancel_absent_ride`; la creación del ride ya persiste su primera generación en
la misma UoW. El arranque y cada ciclo reconcilian búsquedas legacy dándoles una
gracia completa desde la reconciliación. El worker toma fencing PostgreSQL, consulta Redis y solo
cancela `SEARCHING && !paused` cuando no quedan lease ni gracia. Redis caído o
recién recuperado aplaza la acción sin agotar sus reintentos.

`GET /health` y `GET /health/live` son liveness sin dependencias. `GET
/health/ready` comprueba PostgreSQL, Redis cuando corresponde y que los workers
habilitados continúen activos. `GET /health/realtime` expone únicamente agregados sanitizados de
pendientes, reintentos, cuarentenas, edad y demora conservadora
`created_at → published_at`; nunca incluye topics ni payloads.
`GET /metrics` expone el mismo corte en OpenMetrics 1.0 únicamente cuando
`OPENMETRICS_ENABLED=true`; el despliegue debe restringirlo a la red de
monitoreo. Las reglas versionadas y el runbook viven en
`ops/monitoring/prometheus/`.

La retención de publicados es opt-in (`...RETENTION_DAYS=0` por defecto) y
trabaja por batches completos, con una transacción y un chunk acotado por
intervalo. No elimina
cuarentenas ni contadores de agregado/stream. Antes de activarla se debe observar
el backlog del entorno y elegir el TTL; `30` días es solo un ejemplo operativo,
no un valor predeterminado.

## API (v1, prefijo `/api/v1`)

- **auth** (`/auth`): `POST /register`, `POST /login`, `POST /refresh`, `POST /oauth/{provider}`, `GET /me`.
- **rides** (`/rides`):
  - `POST ""` (crear solicitud), `GET /recent-destinations`, `GET /history`, `GET /{id}`.
    `GET /history` pagina con cursor opaco y responde `{items, next_cursor}`.
  - `GET /open` (conductor: solicitudes `SEARCHING` de su `vehicle_type`, **filtradas por presencia**),
    paginado con la misma forma `{items, next_cursor}`.
  - `GET /{id}/offers`, `POST /{id}/offers` (conductor crea oferta: `accept_at_fare=True` usa el fare, o contraoferta con `price`+`eta_min`).
  - `POST /offers/{offer_id}/accept` (pasajero: asignación **directa atómica**), `/reject`, `/withdraw`.
  - `PATCH /{id}/status` (conductor: `ACCEPTED→ARRIVING→IN_PROGRESS→COMPLETED`).
  - `PATCH /{id}/fare` (pasajero: subir la oferta en búsqueda), `POST /{id}/pause-edit` + `PATCH /{id}` (modificar solicitud), `POST /{id}/cancel`, `POST /{id}/rating`.
- **drivers** (`/drivers`): `POST /me/online`, `GET /me/active-ride`, `GET /me/earnings`.
- **saved-places** (`/saved-places`): `GET ""`, `POST ""`, `PUT /{place_id}`, `DELETE /{place_id}`.

Rutas protegidas: usan `CurrentUserDep` (header `Authorization: Bearer <access_token>`).

### Casos de uso (36)

`register_user`, `authenticate_user`, `authenticate_with_oauth`, `refresh_token`,
`create_ride_request`, `announce_open_ride`, `list_recent_destinations`, `list_open_rides`, `dismiss_open_ride`,
`get_ride`, `get_passenger_active_ride`, `get_pending_rating_ride`, `list_ride_history`,
`create_offer`, `list_offers_for_ride`, `accept_offer`, `reject_offer`,
`withdraw_offer`, `expire_offer`, `update_ride_status`, `update_ride_fare`, `cancel_ride`,
`cancel_ride_on_disconnect`, `pause_ride_for_edit`, `edit_ride`,
`rate_ride`, `skip_ride_rating`, `set_driver_online`, `get_driver_active_ride`,
`get_driver_earnings`, `list_saved_places`, `create_saved_place`, `update_saved_place`,
`delete_saved_place`.

Operación de outbox: `get_realtime_outbox_operational_snapshot` y
`purge_published_realtime_outbox`.

## Modelo de negociación (el pasajero decide)

El pasajero crea un `RideRequest` (`SEARCHING`). `VehicleType` representa solo el vehículo
físico (`taxi`/`moto`) y `ServiceType` el servicio (`taxi`/`moto`/`delivery`): los viajes
personales exigen coincidencia y ambos vehículos pueden atender encomiendas. Los conductores
compatibles ofertan (`Offer` `PENDING`). **El pasajero decide**: `POST /offers/{id}/accept` =
**asignación directa** — `OfferRepository.accept_atomically` usa `SELECT … FOR UPDATE` en
Postgres: fija `driver_id`/`accepted_offer_id`, rechaza las demás offers del viaje y retira las
offers vivas del conductor elegido en **otros rides** (`OfferAcceptance.withdrawn_offers` /
`losing_driver_ids`). **Regla de oro**: si el conductor ya fue asignado a otro viaje →
`DriverUnavailableError` (HTTP 409).

- **Mejorar oferta** (mismo conductor, mismo ride): **reemplaza** la anterior → se emite
  `offer_withdrawn {reason:"superseded"}` + `offer_created` (NO hay un evento `offer_superseded` propio).
- **Modificar solicitud NO cancela** (ortogonal al status): `POST /{id}/pause-edit` oculta la
  solicitud del pool y emite **tres** cosas: `RIDE_CLOSED` al pool, `RIDE_PAUSED` (payload completo
  del ride) a cada conductor con oferta viva, y `OFFER_WITHDRAWN` al pasajero. `PATCH /{id}` edita
  origen/destino/servicio/fare/pago y la republica. Flag `RideRequest.paused`.
- **Aumentar oferta**: `PATCH /{id}/fare` sube el fare (solo en `SEARCHING`) y reanuncia al pool
  (`ride_created` con el monto nuevo).
- **Expiración**: la oferta caduca a los 30 s (`OFFER_TTL` en `domain/ride_policy.py`); la solicitud
  no caduca mientras el pasajero siga presente, pero se cancela si desaparecen WS y heartbeat HTTP
  durante la gracia. La creación persiste `expire_offer` en su misma transacción.
  En `off` el timer local sigue siendo la vía activa; en `shadow` compite de forma
  idempotente con el worker durable y se conserva la publicación legacy; en
  `live` solo ejecuta el worker. `mark_expired_if_pending` bloquea la fila y usa el
  reloj PostgreSQL; `accept_atomically` revalida el mismo TTL con ese reloj después
  de sus locks, por lo que aceptación/rechazo/retiro siguen siendo race-safe.
  La mutación, sus dos destinos (`driver:*` y `ride:*`) y el ack se confirman juntos
  en live. Al (re)conectar el conductor, `driver_ws` conserva el barrido defensivo.
- **Calificación**: `POST /{id}/rating` crea `RideRating` (score 1–5, único por `(ride_id, rater_id)`)
  y recalcula el `rating` promedio del `User` calificado.

## Tiempo real (WebSocket)

Endpoints en `api/v1/ws/negotiation.py` (auth: subprotocolos `viajaya.auth` + access token,
fuera de la URL y los access logs; cierre 1008 si es inválido):

- **`WS /ws/rides/{ride_id}`** — pasajero dueño. Snapshot inicial `offers_snapshot` + eventos del `ride_topic`.
- **`WS /ws/driver`** — conductor en línea. Handshake ordenado `open_rides_snapshot` →
  `driver_offers_snapshot` → `driver_active_ride` (si existe); excluye ofertas vencidas y recupera
  ofertas pendientes/viaje activo al reiniciar. Después recibe eventos de su
  `pool:{vehicle_type}`, de `pool:delivery` y de `driver:{id}`. Una barrera de entrega evita la
  ventana ciega entre snapshot y suscripción. `open_rides_snapshot.data` usa
  `{items, next_cursor}`; `paused_rides_snapshot.data` conserva su lista.

Con `REALTIME_OUTBOX_DISPATCH_MODE=live_local|live_redis`, cada socket recibe en cambio un
único snapshot v2 (`ride_snapshot` o `driver_snapshot`) con watermarks, seguido
exclusivamente por envelopes v2 durables. La barrera local suscribe antes de la
captura; los deltas ya incluidos quedan por debajo del watermark y el cliente
los deduplica. En cualquier otro modo se conserva exactamente el handshake
legacy anterior.

**Eventos** (`api/v1/events.py`, publicados vía `hub.broadcast` a `ride_topic`/`driver_topic`/`pool_topic`):

```
ride_created, ride_closed, ride_paused, offer_created, offer_rejected,
offer_withdrawn, offer_accepted, offers_withdrawn (plural), offer_expired, ride_status
```

- `offers_withdrawn` (plural) → al conductor elegido o desconectado: conserva
  `ride_ids` para clientes legacy y añade `offers: [{ride_id, offer_id}]` para que
  una entrega atrasada no retire una reoferta posterior. Los productores nuevos
  emiten ambos campos en el mismo orden; el envelope v2 exige `offers`.
- Todo productor actual de `ride_closed` incluye `pool_version` y
  `reason=paused|terminal`. Ambos solo son opcionales al leer legacy histórico;
  el envelope v2 los exige.
- El polling del cliente queda **solo como respaldo lento**; la vía principal es el WS.
- Crear/reemplazar/retirar/rechazar/vencer oferta, aceptar oferta, avanzar,
  cambiar disponibilidad, pausar, cancelar,
  renovar el pool y anunciar presencia ya persisten antes del commit sus batches
  ordenados en `realtime_outbox` cuando
  `REALTIME_OUTBOX_RECORDING_ENABLED=true`; la entrega directa reutiliza esos
  mismos payloads `{type,data}`. El dispatcher `shadow` solo valida y marca la
  copia durable; la publicación directa continúa siendo la única entrega al
  cliente. Ambos modos live cambian ambas piezas de forma atómica: el dispatcher
  entrega metadata durable v2 y el hub bloquea la ruta directa legacy durante
  todo el lifespan. `live_redis` habilita varios hubs solo detrás del flag de
  presencia compartida y con `cancel_absent_ride` en el scheduler live.

Presencia (`api/v1/presence.py`): la solicitud aparece en `/rides/open` mientras el pasajero esté
conectado al WS o dentro de la ventana de gracia (`PRESENCE_GRACE_SECONDS = 120`). Minimizar/cambiar
de pantalla no la saca; `GET /rides/me/active` renueva la presencia mientras HTTP siga vivo. Solo
cerrar la app o perder ambos canales durante toda la gracia cancela la búsqueda.

## Migraciones (Alembic)

- Config: `alembic.ini` + `migrations/env.py` (engine **async** con `async_engine_from_config`).
- **22 migraciones** en `migrations/versions/` (`0001_create_users` …
  `0022_scheduled_actions`).
- Importante: los enums se persisten por **valor** minúsculo vía `values_callable=_enum_values`
  en `infrastructure/db/models.py` (migración `0006_normalize_enum_values`). No rompas esa convención
  o se caerán columnas existentes.
- Offline mode **no soportado** (`env.py` lo rechaza). Comandos: `alembic upgrade head`,
  `alembic revision -m "..."` (revisar el autogenerado).

## Seed y utilidades

```bash
python -m scripts.seed        # idempotente; requiere DB levantada + alembic upgrade head
python -m scripts.smoke_ws    # prueba de humo del flujo WS contra servidor en vivo (passenger + driver simulados)
```

`scripts/` es un namespace package (`__init__.py`). El seed crea 2 usuarios por rol (contraseña
común `ViajaYa1234#`): `passenger1/2@viajaya.com`, `driver.auto1/2@viajaya.com` (taxi) y
`driver.moto1/2@viajaya.com` (moto).

## Tests

- `tests/unit/` — UC con dobles (`tests/fakes.py`), sin DB real.
- `tests/e2e/` — API completa contra SQLite async (`aiosqlite`); fixtures en `conftest.py`
  (override de `get_session` y `get_oauth_verifiers` con `FakeVerifier`).
- `tests/e2e/test_negotiation_ws.py` — flujo WS de negociación passenger↔driver.
- `tests/postgresql/` — certificación destructiva opt-in contra una base exclusivamente
  desechable indicada por `VIAJAYA_TEST_DATABASE_URL`; hace skip si la variable no existe.
  `test_pg_outbox_0018.py` verifica el ciclo de migración y que dos workers
  reclamen batches completos y disjuntos con `SKIP LOCKED`;
  `test_pg_outbox_0020.py` certifica la cuarentena y su downgrade protegido.
- `.github/workflows/ci.yml` ejecuta en paralelo la suite rápida, la certificación
  PostgreSQL 16 y las comprobaciones TypeScript/ESLint de mobile.
- `asyncio_mode = "auto"` (pytest-asyncio): no hace falta `@pytest.mark.asyncio`.
- Al añadir un UC o endpoint, acompáñalo de su test unitario y/o e2e.

## Convenciones

- Todo async de punta a punta (FastAPI, SQLAlchemy async, repos `async def`).
- `from __future__ import annotations` al inicio de cada módulo; type hints en todo.
- Docstrings y comentarios en **español** (sigue el estilo del repo).
- Ruff con `line-length = 100`, `target-version = "py311"`, reglas `E,F,I,UP,B,C4`.
- Imports ordenados por isort (regla `I`).
