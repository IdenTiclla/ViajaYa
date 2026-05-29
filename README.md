# ViajaYa (TaxiGo)

Aplicación de taxis y envío de encomiendas. Monorepo con backend FastAPI y app
móvil React Native (Expo + TypeScript), siguiendo arquitectura limpia.

## Estructura

```
ViajaYa/
├── backend/                 # API FastAPI (Clean Architecture)
├── mobile/                  # App Expo + React Native + TypeScript (próximamente)
├── docs/implementation-plans/
└── docker-compose.yml       # PostgreSQL para desarrollo
```

## Requisitos

- Python 3.11+ y Docker (backend)
- Node 18+ y Expo CLI (mobile)

## Puesta en marcha del backend

```bash
# 1. Levantar PostgreSQL
docker compose up -d db

# 2. Crear entorno e instalar dependencias
cd backend
python3 -m venv .venv && source .venv/bin/activate
pip install -e ".[dev]"

# 3. Configurar variables de entorno
cp .env.example .env   # editar JWT_SECRET y credenciales OAuth

# 4. Aplicar migraciones
alembic upgrade head

# 5. Levantar la API
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
# Swagger: http://localhost:8000/docs
```

## Tests del backend

```bash
cd backend && pytest
```

## Estado

- [x] Fase 0 — Andamiaje del monorepo
- [x] Fase 1 — Backend dominio + infraestructura base
- [x] Fase 2 — Backend auth local (email/contraseña + JWT)
- [x] Fase 3 — Backend SSO Google + Facebook
- [x] Fase 4 — App móvil: andamiaje Expo + design system
- [x] Fase 5 — App móvil: auth email/contraseña (login/registro + gate)
- [x] Fase 6 — App móvil: SSO Google + Facebook
- [ ] Fase 7-8 — Home (mapa con ubicación) y verificación E2E

Ver `docs/implementation-plans/0001-auth-y-home-map.md`.

## Puesta en marcha del mobile

```bash
cd mobile
npm install
cp .env.example .env    # API_URL (IP LAN del backend), claves Maps/OAuth
npx expo start          # luego abrir en emulador/Expo Go/dev build
# Calidad:
npx tsc --noEmit && npx eslint .
```
