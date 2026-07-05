# ViajaYa (TaxiGo) — Monorepo

Aplicación de **taxis y envío de encomiendas** con negociación de tarifa en tiempo real entre
pasajero y conductor. Monorepo con dos proyectos independientes que siguen **Clean Architecture**:
un backend FastAPI y una app móvil Expo/React Native.

## Estructura

```
ViajaYa/
├── backend/                 # API FastAPI (Python 3.11+, async, PostgreSQL). Ver backend/CLAUDE.md
├── mobile/                  # App Expo + React Native + TypeScript. Ver mobile/CLAUDE.md
├── docs/implementation-plans/   # Planes de implementación por fases (0001-…)
├── docker-compose.yml       # PostgreSQL para desarrollo
└── README.md                # Estado del producto y contexto de negocio
```

**Cada subproyecto tiene su propio `CLAUDE.md`** con arquitectura, comandos y convenciones detalladas.
**Léelo antes de trabajar dentro de `backend/` o `mobile/`.**

## Cómo orientarte

| ¿Qué vas a tocar? | Dónde mirar |
|---|---|
| API, dominio, DB, auth o WebSockets del servidor | `backend/CLAUDE.md` |
| Pantallas, navegación, mapas, estado o WS del cliente | `mobile/CLAUDE.md` |
| Contexto/estado del producto, decisiones de negocio | `README.md` + `docs/implementation-plans/` |
| Contrato entre backend y mobile | sección "Contrato backend ↔ mobile" abajo |

## Arranque rápido

```bash
# 1) Base de datos (PostgreSQL en Docker)
docker compose up -d db

# 2) Backend
cd backend
source .venv/bin/activate         # o: uv sync && source .venv/bin/activate
pip install -e ".[dev]"           # o: uv sync (si usas uv — recomendado)
cp .env.example .env              # editar JWT_SECRET y credenciales OAuth
alembic upgrade head
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000   # Swagger: /docs

# 3) Mobile (en otra terminal)
cd mobile
npm install
cp .env.example .env              # API_URL = IP LAN del backend, claves Maps/OAuth
npx expo start                    # dev build en emulador/dispositivo (NO Expo Go)
```

> **Entorno Python:** si usas VSCode vía snap, crea el venv con `uv` (Pythons en `~/.local`) —
> el snap de VSCode rompe el venv del backend al actualizarse.

## Modelo de negocio (resumen)

- El **pasajero** crea un `RideRequest` (`SEARCHING`) con origen, destino, tipo de servicio
  (`taxi`/`moto`), método de pago (`qr`/`cash`) y una tarifa inicial.
- Los **conductores** con `vehicle_type` coinciente ven la solicitud y **ofertan**: aceptar al
  fare del pasajero o contraofertar (precio + ETA). La oferta caduca a los **30 s**.
- **El pasajero decide**: aceptar una oferta = asignación directa atómica del conductor; o
  **modificar** su solicitud (la pausa del pool sin cancelar); o **aumentar su oferta** (sube el
  fare para atraer más conductores).
- El conductor avanza el viaje: `ACCEPTED → ARRIVING → IN_PROGRESS → COMPLETED`; al final el
  pasajero califica (score 1–5, recalcula el rating del conductor).
- **Tiempo real:** todo esto se notifica por **WebSocket** (pool de conductores, ride del pasajero,
  conductor individual); el polling HTTP del cliente queda solo como respaldo lento.

## Contrato backend ↔ mobile

- La API vive bajo `/api/v1`. El mobile la consume vía `env.apiUrl` (config en `mobile/app.config.ts`).
- **Auth:** JWT Bearer. El cliente guarda access/refresh token y refresca ante 401 (interceptor en
  `mobile/src/core/http/client.ts`); el backend valida en `backend/app/api/deps.py`.
- **WebSocket:** token por query param `?token=…` (RN no permite headers en `WebSocket`).
  Endpoints: `/ws/driver` (pool + viaje activo del conductor), `/ws/rides/{ride_id}` (ofertas y
  estado al pasajero). Eventos en `backend/app/api/v1/events.py`.
- **Al cambiar un endpoint o un schema en el backend, actualiza el tipo/repositorio correspondiente
  en el feature del mobile** (`features/<feature>/data` y `domain/types.ts`). Mantén ambos lados en sintonía.
- **CORS:** orígenes permitidos con `CORS_ORIGINS` en el backend (`.cors_origins_list`).

## Convenciones globales

- **Idioma:** código, comentarios, docs y mensajes de commit en **español**.
- **Arquitectura:** ambos proyectos respetan límites de capas (dominio sin dependencias hacia afuera).
  No cruces capas para "ir más rápido"; sigue las reglas del `CLAUDE.md` del subproyecto.
- **Antes de commitear:** corre lint y type-check del subproyecto tocado
  (`ruff check .` / `pytest` en backend; `npx tsc --noEmit` / `npm run lint` en mobile).
- **Commits:** mensajes en español, estilo Conventional Commits (`feat(scope): …`, `fix(scope): …`,
  `docs(scope): …`, `chore(scope): …`), como en el historial.
- **Secretos:** nunca commitees `.env`; usa los `.env.example` como plantilla.
