# ViajaYa

**Política vigente (19/09/2026):** usamos únicamente **Desarrollo**. **Pruebas (`testing`/`preview`/staging) queda temporalmente deprecado**: no iniciar, desplegar ni generar entregas para ese entorno. Producción sigue siendo un objetivo futuro. Las configuraciones anteriores se conservan como referencia; las pruebas automatizadas y las bases desechables de CI continúan vigentes.

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

- [x] Acceso por teléfono/OTP simulado, sesiones revocables y vinculación social.
  Google probado en Desarrollo; SMS real pendiente para la futura apertura.
  Facebook permanece aplazado. No existe acceso por correo/contraseña.
- [x] Solicitudes de taxi, moto y encomienda con rutas en mapa.
- [x] Pool de conductores y negociación de ofertas con vencimiento a 30 s.
- [x] Ciclo de vida del viaje, historial, ganancias y calificaciones.
- [x] Actualización en vivo por WebSocket y cancelación por ausencia.
- [x] CI con PostgreSQL real, contratos OpenAPI/WS y tipos mobile generados.
- [x] Tiempo real durable y soporte multiworker mediante outbox, Redis y
  presencia compartida (activación operativa todavía detrás de flags).
- [x] Registro desde Perfil, varios vehículos por conductor y cambio de modo/vehículo.
  Documentos, revisión administrativa, suspensión y operación aún pendientes.

**Salida a producción — revisión 19/09/2026:** F01 completada localmente; F02 en
curso y F04 parcialmente implementada. F03 está planificada; seguimiento GPS y navegación Android tienen entrega local (0022);
la certificación de navegación en teléfonos, cobros/comisiones, encomiendas completas,
certificación alojada y Google Play siguen pendientes. Seleccionar QR todavía no procesa un
pago. Ver el [plan vigente](docs/plans/plan-salida-produccion.md) y la
[evidencia de revisión](docs/plans/production-readiness-2026-09-19.md).

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

**Navegación y seguimiento (19/09/2026):** GPS privado para el pasajero, navegación Android hacia recogida/destino y Waze implementados en Desarrollo. APK debug compilado; 746 pruebas backend y 429 móviles aprobadas. Falta certificar el recorrido con dos teléfonos, GPS real y autorización del Navigation SDK. Ver [entrega 0022](docs/implementation-plans/0022-driver-navigation-and-live-tracking.md).
