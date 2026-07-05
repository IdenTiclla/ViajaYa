# ViajaYa — Backend (FastAPI + Clean Architecture)

API de taxis y encomiendas. Python 3.11+, FastAPI async, SQLAlchemy 2.0 async sobre
PostgreSQL, autenticación JWT y SSO (Google/Facebook).

## Arquitectura (Clean Architecture)

Las dependencias apuntan siempre **hacia adentro**: `api → application → domain`.
La infraestructura implementa interfaces del dominio/aplicación y se conecta en `api/deps.py`.

```
app/
├── domain/              # Núcleo. SIN dependencias de framework.
│   ├── entities.py        # User, RideRequest, SavedPlace + enums (AuthProvider, ServiceType, PaymentMethod, RideStatus)
│   ├── value_objects.py   # Objetos de valor (coordenadas, etc.)
│   ├── repositories.py    # Interfaces (puertos) de persistencia
│   └── exceptions.py      # Excepciones de dominio (InvalidTokenError, ...)
├── application/         # Casos de uso. Orquestan el dominio.
│   ├── use_cases/         # Un archivo por caso de uso (RegisterUser, CreateRideRequest, ...)
│   ├── interfaces.py      # Puertos (TokenService, SocialIdentityVerifier, ...)
│   ├── dto.py             # DTOs de entrada/salida entre capas
│   └── token_issuer.py
├── infrastructure/      # Adaptadores concretos.
│   ├── config.py          # Settings (pydantic-settings). ÚNICA fuente de verdad de config.
│   ├── db/                # SQLAlchemy: models, session, repositories, base
│   ├── security/          # bcrypt_hasher, jwt_service
│   └── oauth/             # google_verifier, facebook_verifier
└── api/                 # Capa HTTP (FastAPI).
    ├── deps.py            # Inyección de dependencias: ÚNICO lugar donde se cablea infra→app
    ├── errors.py          # Manejadores de excepciones → respuestas HTTP
    └── v1/
        ├── routers/       # auth, rides, saved_places
        └── schemas/       # Modelos Pydantic request/response (NO reusar entities)
```

### Reglas al añadir código

- **El dominio no importa nada de `application`, `infrastructure` ni `api`.** Si una entidad
  necesita un servicio externo, defínelo como interfaz (puerto) y recibe la implementación por inyección.
- **Un caso de uso por archivo** en `application/use_cases/`, con su `__call__` o método `execute`.
- **Toda construcción de objetos vive en `api/deps.py`.** Cada caso de uso tiene su factory
  `get_*` y se expone como `Annotated[T, Depends(...)]`. No instancies repos/servicios en los routers.
- **Los routers solo traducen HTTP↔caso de uso.** Reciben schemas Pydantic, llaman al caso de uso
  inyectado y devuelven un response_model. Sin lógica de negocio.
- **Schemas (`api/v1/schemas/`) ≠ entities.** Nunca expongas entidades del dominio directamente en la API.
- **Errores:** lanza excepciones de dominio; conviértelas a HTTP en `api/errors.py` (no `HTTPException` disperso).

## Comandos

```bash
cd backend
source .venv/bin/activate         # entorno virtual

# Levantar DB (desde la raíz del repo)
docker compose up -d db

# Migraciones (Alembic)
alembic upgrade head              # aplicar
alembic revision -m "mensaje"     # nueva migración (revisar el autogenerado a mano)

# Servidor de desarrollo
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
# Swagger: http://localhost:8000/docs   ·   Health: GET /health

# Tests
pytest                            # todo
pytest tests/unit                 # solo unitarios (casos de uso con fakes)
pytest tests/e2e                  # API end-to-end (httpx + aiosqlite)

# Calidad
ruff check .                      # lint
ruff check --fix . && ruff format .
```

## Configuración

`infrastructure/config.py` (`Settings`) lee de `.env` (ver `.env.example`). Variables clave:
`DATABASE_URL` (driver `postgresql+asyncpg`), `JWT_SECRET`, `JWT_ALGORITHM`, expiraciones de tokens,
`CORS_ORIGINS` (lista separada por comas), `GOOGLE_CLIENT_ID`, `FACEBOOK_APP_ID/SECRET`.
Accede a la config con `get_settings()` (cacheado con `@lru_cache`); no leas `os.environ` directo.

## API (v1, prefijo `/api/v1`)

- **auth** (`/auth`): `POST /register`, `POST /login`, `POST /refresh`, `POST /oauth/{provider}`, `GET /me`
- **rides** (`/rides`):
  - `POST ""` (crear solicitud), `GET /recent-destinations`, `GET /history`
  - `GET /open` (conductor: solicitudes `SEARCHING` de su `vehicle_type`)
  - `GET /{id}` (detalle del viaje, pasajero o conductor asignado)
  - `GET /{id}/offers`, `POST /{id}/offers` (pasajero lista; conductor crea oferta: aceptar al fare o contraofertar)
  - `POST /offers/{offer_id}/accept` (pasajero: elige oferta → asigna conductor), `/reject`, `/withdraw`
  - `PATCH /{id}/status` (conductor: `ACCEPTED→ARRIVING→IN_PROGRESS→COMPLETED`), `POST /{id}/rating`
  - `PATCH /{id}/fare` (pasajero: subir la oferta en búsqueda), `POST /{id}/pause-edit` + `PATCH /{id}` (modificar solicitud), `POST /{id}/cancel`
- **drivers** (`/drivers`): `POST /me/online`, `GET /me/active-ride`, `GET /me/earnings`
- **saved-places** (`/saved-places`): `GET ""`, `POST ""`, `PUT /{place_id}`, `DELETE /{place_id}`
- **WebSocket** (`app/api/v1/ws/`): `/ws/rides/{ride_id}` (pasajero: ofertas/estado),
  `/ws/driver` (conductor: pool + su viaje activo). Publican `app/api/v1/events.py` vía
  `hub.broadcast` a `ride_topic`/`driver_topic`/`pool_topic`.

Rutas protegidas: usan `CurrentUserDep` (header `Authorization: Bearer <access_token>`).

### Modelo de negociación (el pasajero decide)

El pasajero crea un `RideRequest` (`SEARCHING`); los conductores cuyo `vehicle_type`
coincide ofertan (`Offer` `PENDING`: aceptar al `fare` o contraofertar con `price`+`eta_min`;
mejorar la oferta **reemplaza** la anterior y devuelve la vieja para retirarla). **El pasajero
decide**: `POST /offers/{id}/accept` = **asignación directa** (`ACCEPTED`, demás offers
`REJECTED`, se fija `driver_id`/`accepted_offer_id`); `reject` y `withdraw` disponibles.
El conductor avanza `ACCEPTED→ARRIVING→IN_PROGRESS→COMPLETED`.

- **Modificar solicitud NO cancela** (ortogonal al status): `POST /{id}/pause-edit` oculta la
  solicitud del pool y retira sus offers vivas (`reason=ride_paused`); `PATCH /{id}` edita
  origen/destino/servicio/fare/pago y la republica. Flag `RideRequest.paused`.
- **Aumentar oferta**: `PATCH /{id}/fare` sube el fare (solo en `SEARCHING`) y reanuncia al pool.
- **Expiración**: la oferta caduca a los 30 s (`offer_expired`); la solicitud sigue `SEARCHING`.
- **Tiempo real por WebSocket** (`events.py` + `hub`): `ride_created`, `ride_closed`,
  `offer_created`, `offer_superseded`, `offer_rejected`, `offer_withdrawn`, `offer_accepted`,
  `offer_expired`, `ride_status`. El polling del cliente queda solo como respaldo.

## Seed de datos de prueba

```bash
python -m scripts.seed        # idempotente; requiere DB levantada + alembic upgrade head
```

Crea 2 usuarios por rol (contraseña común `ViajaYa1234#`): `passenger1/2@viajaya.com`,
`driver.auto1/2@viajaya.com` (taxi) y `driver.moto1/2@viajaya.com` (moto).

## Tests

- `tests/unit/` — casos de uso con dobles de prueba (`tests/fakes.py`), sin DB real.
- `tests/e2e/` — la API completa contra SQLite async (`aiosqlite`); fixtures en `conftest.py`.
- `asyncio_mode = "auto"` (pytest-asyncio): no hace falta marcar cada test con `@pytest.mark.asyncio`.
- Al añadir un caso de uso o endpoint, acompáñalo de su test unitario y/o e2e.

## Convenciones

- Todo async de punta a punta (FastAPI, SQLAlchemy async, repos `async def`).
- `from __future__ import annotations` al inicio de cada módulo; type hints en todo.
- Docstrings y comentarios en español (sigue el estilo existente del repo).
- Ruff con `line-length = 100`, reglas `E,F,I,UP,B,C4`. Imports ordenados por isort (regla `I`).
