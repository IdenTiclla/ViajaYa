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
  - `POST ""` (crear solicitud), `GET /recent-destinations`
  - `GET /open` (conductor: solicitudes `SEARCHING` de su `vehicle_type`)
  - `GET /{id}` (polling del detalle del viaje, pasajero o conductor asignado)
  - `GET /{id}/offers` (pasajero: ofertas `PENDING` de su viaje)
  - `POST /{id}/offers` (conductor: aceptar al precio o contraofertar)
  - `POST /offers/{offer_id}/accept` (pasajero: elige una oferta → asigna conductor)
  - `PATCH /{id}/status` (conductor: `ACCEPTED→ARRIVING→IN_PROGRESS→COMPLETED`)
  - `POST /{id}/cancel` (pasajero/conductor, antes de `IN_PROGRESS`)
- **drivers** (`/drivers`): `POST /me/online` (conductor: alterna disponibilidad)
- **saved-places** (`/saved-places`): `GET ""`, `POST ""`, `PUT /{place_id}`, `DELETE /{place_id}`

Rutas protegidas: usan `CurrentUserDep` (header `Authorization: Bearer <access_token>`).

### Modelo de ofertas (entrega 0002)

El pasajero crea un `RideRequest` (`SEARCHING`); los conductores en línea cuyo
`vehicle_type` coincide ofertan (`Offer` `PENDING`: aceptar al `fare` o contraofertar
con `price`+`eta_min`); el pasajero acepta una (`ACCEPTED`, el resto `REJECTED`, se fija
`driver_id`/`accepted_offer_id`) y el conductor avanza el ciclo de vida hasta `COMPLETED`.
Tiempo real por **polling** (sin websockets). `UserRole` distingue `passenger`/`driver`.

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
