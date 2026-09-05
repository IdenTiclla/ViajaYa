# ViajaYa

Aplicación de taxis y envío de encomiendas. Monorepo con backend FastAPI y app
móvil React Native (Expo + TypeScript), siguiendo arquitectura limpia.

## Estructura

```
ViajaYa/
├── backend/                 # API FastAPI (Clean Architecture)
├── mobile/                  # App Expo + React Native + TypeScript
├── docs/implementation-plans/
└── docker-compose.yml       # PostgreSQL + Redis para desarrollo
```

## Requisitos

- Python 3.11+ y Docker (backend)
- Node 22.13+ (mobile; Expo CLI se ejecuta desde las dependencias locales)

## Puesta en marcha del backend

```bash
# 1. Levantar PostgreSQL y Redis
docker compose up -d db redis

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

La integración continua ejecuta en paralelo la suite rápida del backend, las
pruebas transaccionales contra PostgreSQL 16 y las comprobaciones TypeScript y
ESLint de mobile. La certificación PostgreSQL local requiere una base desechable
marcada explícitamente como test mediante `VIAJAYA_TEST_DATABASE_URL`.

## Estado

- [x] Autenticación local y SSO Google/Facebook.
- [x] Solicitudes de taxi, moto y encomienda con rutas en mapa.
- [x] Pool de conductores y negociación de ofertas con vencimiento a 30 s.
- [x] Ciclo de vida del viaje, historial, ganancias y calificaciones.
- [x] Actualización en vivo por WebSocket y cancelación por ausencia.
- [x] CI con PostgreSQL real, contratos OpenAPI/WS y tipos mobile generados.
- [x] Tiempo real durable y soporte multiworker mediante outbox, Redis y
  presencia compartida (activación operativa todavía detrás de flags).

Las reglas vigentes y el endurecimiento pendiente viven en
`docs/implementation-plans/0007-cancela-busqueda-pasajero-ausente.md` y
`docs/implementation-plans/0008-endurecimiento-arquitectura.md`. Los planes
terminados se conservan en `docs/implementation-plans/archived/`.

## Puesta en marcha del mobile

```bash
cd mobile
npm install
cp .env.example .env    # API_URL (IP LAN del backend), claves Maps/OAuth
npx expo start          # luego abrir el dev build en emulador o dispositivo
# Calidad:
npx tsc --noEmit && npm run lint
```
