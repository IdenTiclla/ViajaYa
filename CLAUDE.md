# ViajaYa (TaxiGo) — Monorepo

Aplicación de taxis y envío de encomiendas. Monorepo con dos proyectos independientes
que siguen **Clean Architecture**: un backend FastAPI y una app móvil Expo/React Native.

## Estructura

```
ViajaYa/
├── backend/                 # API FastAPI (Python 3.11+, async, PostgreSQL). Ver backend/CLAUDE.md
├── mobile/                  # App Expo + React Native + TypeScript. Ver mobile/CLAUDE.md
├── docs/implementation-plans/   # Planes de implementación por fases (0001-...)
├── docker-compose.yml       # PostgreSQL para desarrollo
└── README.md
```

**Cada subproyecto tiene su propio `CLAUDE.md` con arquitectura, comandos y convenciones detalladas.**
Léelo antes de trabajar dentro de `backend/` o `mobile/`.

## Cómo orientarte

- ¿Trabajas en la **API, dominio, DB o auth del servidor**? → `backend/CLAUDE.md`
- ¿Trabajas en **pantallas, navegación, mapas o estado del cliente**? → `mobile/CLAUDE.md`
- ¿Necesitas el **contexto/estado del producto**? → `README.md` (sección "Estado", planes en `docs/`)

## Arranque rápido

```bash
# 1) Base de datos (PostgreSQL en Docker)
docker compose up -d db

# 2) Backend
cd backend
python3 -m venv .venv && source .venv/bin/activate
pip install -e ".[dev]"
cp .env.example .env            # editar JWT_SECRET y credenciales OAuth
alembic upgrade head
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000   # Swagger: /docs

# 3) Mobile (en otra terminal)
cd mobile
npm install
cp .env.example .env            # API_URL = IP LAN del backend, claves Maps/OAuth
npx expo start
```

## Contrato backend ↔ mobile

- La API vive bajo `/api/v1`. El mobile la consume vía `env.apiUrl` (config en `mobile/app.config.ts`).
- **Auth:** JWT Bearer. El cliente guarda el access/refresh token y refresca ante 401
  (interceptor en `mobile/src/core/http/client.ts`); el backend valida en `backend/app/api/deps.py`.
- **Al cambiar un endpoint o un schema en el backend, actualiza el tipo/repositorio correspondiente
  en el feature del mobile** (`features/<feature>/data` y `domain/types.ts`). Mantén ambos lados en sintonía.
- CORS: los orígenes permitidos se configuran con `CORS_ORIGINS` en el backend.

## Convenciones globales

- **Idioma:** código, comentarios, docs y mensajes de commit en **español**.
- **Arquitectura:** ambos proyectos respetan límites de capas (dominio sin dependencias hacia afuera).
  No cruces capas para "ir más rápido"; sigue las reglas del `CLAUDE.md` del subproyecto.
- **Antes de commitear:** corre lint y type-check del subproyecto tocado
  (`ruff check .` / `pytest` en backend; `npx tsc --noEmit` / `npm run lint` en mobile).
- **Commits:** mensajes en español, estilo Conventional Commits (`feat(scope): ...`), como en el historial.
- **Secretos:** nunca commitees `.env`; usa los `.env.example` como plantilla.
