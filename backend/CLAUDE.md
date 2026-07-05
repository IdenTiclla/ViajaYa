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
│   │                          #   (AuthProvider, UserRole, ServiceType, PaymentMethod,
│   │                          #    RideStatus, OfferStatus, SavedPlaceCategory)
│   ├── value_objects.py       # Email, RawPassword, GeoPoint, FareOffer (frozen, slots)
│   ├── repositories.py        # Interfaces (puertos): User, RideRequest, Offer, Rating, SavedPlace
│   ├── ride_policy.py         # OFFER_TTL=30s + offer_expires_at / is_offer_expired / is_offer_active
│   └── exceptions.py          # DomainError + 16 excepciones específicas
├── application/             # Casos de uso. Orquestan el dominio.
│   ├── use_cases/             # UN caso de uso por archivo · 29 UC (lista abajo)
│   ├── interfaces.py          # Puertos: PasswordHasher, TokenService, SocialIdentityVerifier
│   ├── dto.py                 # @dataclass(frozen=True) de entrada/salida entre capas
│   └── token_issuer.py        # Helper issue_token_pair(tokens, user_id)  (NO es una clase)
├── infrastructure/          # Adaptadores concretos.
│   ├── config.py              # Settings (pydantic-settings). ÚNICA fuente de verdad de config.
│   ├── db/                    # SQLAlchemy: base, models, session, repositories (SqlAlchemy*)
│   ├── security/              # bcrypt_hasher, jwt_service
│   ├── oauth/                 # google_verifier, facebook_verifier
│   └── realtime/              # hub (singleton pub/sub por topic), ws_auth (token por ?token=)
└── api/                     # Capa HTTP (FastAPI).
    ├── deps.py                # Inyección: ÚNICO cableo infra→app (factories get_*, *Dep)
    ├── errors.py              # DomainError → HTTP (map _STATUS_MAP, sin HTTPException disperso)
    ├── main.py                # create_app(): CORS, handlers, routers con prefijo /api/v1, /health
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

# Levantar DB (desde la raíz del repo)
docker compose up -d db

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
GOOGLE_CLIENT_ID, FACEBOOK_APP_ID, FACEBOOK_APP_SECRET
```

Accede a la config con `get_settings()` (cacheado con `@lru_cache`); **no leas `os.environ` directo**.
CORS se aplica en `main.py` con `cors_origins_list`.

## API (v1, prefijo `/api/v1`)

- **auth** (`/auth`): `POST /register`, `POST /login`, `POST /refresh`, `POST /oauth/{provider}`, `GET /me`.
- **rides** (`/rides`):
  - `POST ""` (crear solicitud), `GET /recent-destinations`, `GET /history`, `GET /{id}`.
  - `GET /open` (conductor: solicitudes `SEARCHING` de su `vehicle_type`, **filtradas por presencia**).
  - `GET /{id}/offers`, `POST /{id}/offers` (conductor crea oferta: `accept_at_fare=True` usa el fare, o contraoferta con `price`+`eta_min`).
  - `POST /offers/{offer_id}/accept` (pasajero: asignación **directa atómica**), `/reject`, `/withdraw`.
  - `PATCH /{id}/status` (conductor: `ACCEPTED→ARRIVING→IN_PROGRESS→COMPLETED`).
  - `PATCH /{id}/fare` (pasajero: subir la oferta en búsqueda), `POST /{id}/pause-edit` + `PATCH /{id}` (modificar solicitud), `POST /{id}/cancel`, `POST /{id}/rating`.
- **drivers** (`/drivers`): `POST /me/online`, `GET /me/active-ride`, `GET /me/earnings`.
- **saved-places** (`/saved-places`): `GET ""`, `POST ""`, `PUT /{place_id}`, `DELETE /{place_id}`.

Rutas protegidas: usan `CurrentUserDep` (header `Authorization: Bearer <access_token>`).

### Casos de uso (29)

`register_user`, `authenticate_user`, `authenticate_with_oauth`, `refresh_token`,
`create_ride_request`, `list_recent_destinations`, `list_open_rides`, `get_ride`,
`list_ride_history`, `create_offer`, `list_offers_for_ride`, `accept_offer`, `reject_offer`,
`withdraw_offer`, `expire_offer`, `update_ride_status`, `update_ride_fare`, `cancel_ride`,
`pause_ride_for_edit`, `edit_ride`, `rate_ride`, `set_driver_online`, `get_driver_active_ride`,
`get_driver_earnings`, `list_saved_places`, `create_saved_place`, `update_saved_place`,
`delete_saved_place`.

## Modelo de negociación (el pasajero decide)

El pasajero crea un `RideRequest` (`SEARCHING`); los conductores cuyo `vehicle_type` coincide
ofertan (`Offer` `PENDING`). **El pasajero decide**: `POST /offers/{id}/accept` =
**asignación directa** — `OfferRepository.accept_atomically` usa `SELECT … FOR UPDATE` en
Postgres: fija `driver_id`/`accepted_offer_id`, rechaza las demás offers del viaje y retira las
offers vivas del conductor elegido en **otros rides** (`OfferAcceptance.withdrawn_ride_ids` /
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
  **no caduca** por tiempo (sigue `SEARCHING` hasta cancelar). Mecanismo: tarea fire-and-forget
  `asyncio.create_task(_expire_offer_after(offer_id))` en `rides.py` que duerme el TTL y llama
  `ExpireOffer` (race-safe: `mark_expired_if_pending` solo vence si sigue `PENDING`) + publica
  `offer_expired`. Al (re)conectar el conductor, `driver_ws` barre y vence sus offers pasadas de TTL.
- **Calificación**: `POST /{id}/rating` crea `RideRating` (score 1–5, único por `(ride_id, rater_id)`)
  y recalcula el `rating` promedio del `User` calificado.

## Tiempo real (WebSocket)

Endpoints en `api/v1/ws/negotiation.py` (auth: access token por query param `?token=…`, RN no permite
headers en `WebSocket`; cierre 1008 si es inválido):

- **`WS /ws/rides/{ride_id}`** — pasajero dueño. Snapshot inicial `offers_snapshot` + eventos del `ride_topic`.
- **`WS /ws/driver`** — conductor en línea. Snapshot `open_rides_snapshot` + al (re)conectar vence
  offers pasadas de TTL (`ExpireOffer`) y recupera el viaje activo (`driver_active_ride`). Suscrito a
  `pool:{vehicle_type}` y `driver:{id}`.

**Eventos** (`api/v1/events.py`, publicados vía `hub.broadcast` a `ride_topic`/`driver_topic`/`pool_topic`):

```
ride_created, ride_closed, ride_paused, offer_created, offer_rejected,
offer_withdrawn, offer_accepted, offers_withdrawn (plural), offer_expired, ride_status
```

- `offers_withdrawn` (plural) → al conductor elegido: lista de `ride_ids` cuyas ofertas suyas se retiraron al ganar el viaje.
- El polling del cliente queda **solo como respaldo lento**; la vía principal es el WS.

Presencia (`api/v1/presence.py`): la solicitud aparece en `/rides/open` mientras el pasajero esté
conectado al WS o dentro de la ventana de gracia (`PRESENCE_GRACE_SECONDS = 120`). Minimizar/cambiar
de pantalla no la saca; solo cerrar la app (sin reconectar tras la gracia).

## Migraciones (Alembic)

- Config: `alembic.ini` + `migrations/env.py` (engine **async** con `async_engine_from_config`).
- **12 migraciones** en `migrations/versions/` (`0001_create_users` … `0012_ride_paused`).
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
- `asyncio_mode = "auto"` (pytest-asyncio): no hace falta `@pytest.mark.asyncio`.
- Al añadir un UC o endpoint, acompáñalo de su test unitario y/o e2e.

## Convenciones

- Todo async de punta a punta (FastAPI, SQLAlchemy async, repos `async def`).
- `from __future__ import annotations` al inicio de cada módulo; type hints en todo.
- Docstrings y comentarios en **español** (sigue el estilo del repo).
- Ruff con `line-length = 100`, `target-version = "py311"`, reglas `E,F,I,UP,B,C4`.
- Imports ordenados por isort (regla `I`).
