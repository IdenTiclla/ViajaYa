# Entornos locales y scripts de operación

**Política vigente (19/09/2026):** usamos únicamente **Desarrollo**. **Pruebas (`testing`/`preview`/staging) queda temporalmente deprecado**: no iniciar, desplegar ni generar entregas para ese entorno. Producción sigue siendo un objetivo futuro. Las configuraciones anteriores se conservan como referencia; las pruebas automatizadas y las bases desechables de CI continúan vigentes.

Cómo levantar Desarrollo en una máquina nueva y verificarlo. Los procedimientos de Pruebas que aparecen más abajo son referencia histórica inactiva.
Los scripts viven en `ops/scripts/`; los artefactos que generan (estado privado, respaldos,
APK, informes) quedan fuera del repositorio.

## Requisitos

| Herramienta | Versión | Para qué |
|---|---|---|
| Node | **24.19.0** (ver `.node-version`) | Metro, EAS y las pruebas de `mobile/` |
| Python | 3.13 con el venv de `backend/` | Backend y estos scripts |
| Docker | Desktop o Engine | PostgreSQL, Redis e imagen del API |
| ngrok | opcional | Publicar Pruebas por HTTPS |
| Android build-tools | opcional, 36.0.0 | Verificar un APK descargado |

Con Node 22 fallan 7 archivos de prueba de `mobile/` por `module.registerHooks`. No es un
fallo del código: usa la versión fijada.

Los scripts dependen de `httpx`, `websockets` y `python-dotenv`, ya incluidos en las
dependencias de desarrollo del backend.

## Primera vez en una máquina

```bash
git clone https://github.com/IdenTiclla/ViajaYa.git && cd ViajaYa

# Backend
cd backend && uv sync && cp .env.example .env      # editar JWT_SECRET y credenciales
cd ..

# Mobile
cd mobile && npm install && cp .env.example .env   # API_URL = IP LAN, claves Maps/OAuth
cd ..
```

En `mobile/.env`, `API_URL` debe apuntar a la IP LAN de esta máquina (`ipconfig` o
`ip addr`), no a `localhost`: el teléfono necesita alcanzarla. `verify_apk.py development`
compara el APK contra ese mismo valor.

**Qué traer de la máquina anterior**, si la hay: `private-state.json` y los dumps de
PostgreSQL. Nada de eso se puede regenerar a partir del repositorio. Sin el estado privado,
la base de Pruebas anterior queda inaccesible y hay que crear un entorno nuevo; sin los
dumps, se pierden las cuentas y el historial.

**Qué no hace falta traer:** las variables del proyecto en EAS, incluida `TESTING_API_URL`,
viven en el servidor de Expo y las ve cualquier máquina con `eas login`.

## Dónde se guarda lo que no se versiona

Por defecto todo cuelga de `local-files/`, ignorado por git. Cada ruta se puede mover con
una variable de entorno:

| Variable | Valor por defecto | Qué es |
|---|---|---|
| `VIAJAYA_WORK_DIR` | `local-files/` | Raíz de artefactos locales |
| `VIAJAYA_TESTING_STATE` | `<work>/phase01/testing/private-state.json` | Estado privado de Pruebas: contraseñas, secreto JWT, URL pública |
| `VIAJAYA_APK_DIR` | `<work>/phase01/apks` | APK descargados |
| `VIAJAYA_ANDROID_BUILD_TOOLS` | `<work>/tools/android/build-tools-36.0.0/android-16` | `aapt2` y `apksigner` |
| `VIAJAYA_EAS_COMMAND` | `eas` del PATH, o `npx --yes eas-cli` | Cómo invocar la CLI de EAS |
| `VIAJAYA_DEVELOPMENT_ORIGIN` | `http://127.0.0.1:8000` | API de Desarrollo |
| `VIAJAYA_TESTING_ORIGIN` | `http://127.0.0.1:8001` | API de Pruebas antes del túnel |
| `VIAJAYA_DEVELOPMENT_API_URL` | `API_URL` de `mobile/.env` | URL que lleva grabada el APK de Desarrollo |
| `VIAJAYA_API_IMAGE` | `viajaya-phase2:runtime` | Imagen a promover en Pruebas |
| `VIAJAYA_SEED_PASSWORD` | `ViajaYa1234#` | Contraseña de las cuentas sembradas |

**El estado privado no se puede recuperar del repositorio.** Si lo pierdes, la base de
Pruebas existente queda inaccesible: hay que recrear el entorno y volver a sembrarlo.
Respáldalo junto con tus dumps.

## Desarrollo

```bash
docker compose up -d db redis
cd backend && alembic upgrade head
APP_ENV=development PHONE_OTP_ENABLED=true \
  python -m uvicorn app.main:app --reload --host 0.0.0.0 --port 8000

cd ../mobile && APP_ENV=development npx expo start --host lan
```

La app de Desarrollo es un *development client*: no lleva el código dentro, lo descarga de
Metro. Si ves "connecting to the development server", Metro no está corriendo. Solo hay que
recompilarla cuando se añade una librería nativa.

`API_URL` en `mobile/.env` debe apuntar a la IP LAN de esta máquina, no a `localhost`.

## Pruebas

Entorno desechable y aislado: su propia base, Redis, secreto JWT y cuentas.

```bash
# 1) Imagen del API
cd backend && docker build --target runtime -t viajaya-phase1:runtime .

# 2) Estado y definición Compose (la primera vez genera contraseñas nuevas)
python ops/scripts/manage_testing.py prepare

# 3) Infraestructura, migraciones y API
docker compose -f local-files/phase01/testing/compose.json \
  -p viajaya-testing-local up -d testing-database testing-cache
python ops/scripts/manage_testing.py start-api
python ops/scripts/manage_testing.py seed      # cuentas ficticias
python ops/scripts/manage_testing.py status
```

`prepare` genera contraseñas y secreto JWT nuevos la primera vez, y no vuelve a tocarlos
en ejecuciones posteriores. No necesita la imagen de cloudflared: si no está, el entorno se
genera sin servicio de túnel, que es lo correcto cuando el túnel corre en el host.

`start-api` exige que el estado tenga una `api_url`, la URL pública con la que se compilará
el APK. Se fija sin editar el JSON a mano:

```bash
python ops/scripts/manage_testing.py set-url https://<tu-dominio>/api/v1
```

Para restaurar un respaldo en una base recién creada:

```bash
docker exec -i <contenedor-db> pg_restore -U viajaya_testing -d viajaya_testing \
  --no-owner --no-privileges < respaldo.dump
python ops/scripts/manage_testing.py start-api   # aplica las migraciones que falten
```

## Túnel HTTPS

El APK de Pruebas lleva la URL grabada dentro, así que **usa un dominio estable**. Un túnel
de URL aleatoria obliga a recompilar cada vez que se reinicia.

```bash
ngrok config add-authtoken <token>          # en una terminal aparte, no en un agente
ngrok http --url=https://<tu-dominio> 8001
```

Después, fija la URL y reinicia el API para que `CORS_ORIGINS` y `PUBLIC_API_URL`
coincidan:

```bash
python ops/scripts/manage_testing.py set-url https://<tu-dominio>/api/v1
python ops/scripts/manage_testing.py start-api
```

## Compilar e instalar el APK de Pruebas

```bash
python ops/scripts/verify_live_phone_access.py    # exige que Desarrollo y Pruebas pasen
python ops/scripts/configure_testing_build.py     # actualiza TESTING_API_URL en EAS
python ops/scripts/start_testing_build.py --review-only    # qué se subiría
python ops/scripts/start_testing_build.py --preflight-only # URL pública viva
python ops/scripts/start_testing_build.py         # lanza la compilación
python ops/scripts/verify_apk.py testing          # tras descargar el APK
```

`app.config.ts` se evalúa **en el servidor de EAS**, no en tu máquina: la URL sale de la
variable `TESTING_API_URL` del entorno `preview`. Saltarse `configure_testing_build.py`
produce un APK que apunta a la URL anterior. Por eso `verify_apk.py` la comprueba.

El perfil de EAS se llama `preview` porque los entornos de variables de Expo solo admiten
`development`, `preview` y `production`. La app se identifica como `testing` en todo lo
demás: `APP_ENV`, canal, paquete `com.viajaya.app.testing` y esquema `viajaya-testing`.

## Verificaciones

| Script | Qué comprueba |
|---|---|
| `verify_live_phone_access.py` | OTP simulado, alta sin correo, reintento idempotente, sesiones, rotación de refresh, revocación y aislamiento, en ambos entornos. `--local` evita el túnel |
| `verify_local_websockets.py` | Login de conductor anterior y WebSocket en ambos entornos locales |
| `verify_testing.py` | Pruebas por HTTPS público: readiness, login, refresh, cabecera de entorno incorrecta, token cruzado y WebSocket |
| `verify_apk.py <entorno>` | Integridad ZIP, configuración embebida, identidad nativa, clave de Maps, bundle propio y firma |
| `backup_database.py <etiqueta> [contenedor]` | Respaldo en formato custom antes de migrar |
| `activate_testing.py` | Respalda Pruebas y reemplaza solo su servicio de API |

Estos scripts escriben informes JSON en `<work>/phase02/`. Ninguno envía SMS ni contrata
servicios externos; el OTP es simulado en Desarrollo y Pruebas, y Producción lo rechaza.
