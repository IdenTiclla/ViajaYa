# Entornos de ViajaYa

La fase F01 prepara configuración, identidades móviles, dependencias y despliegues reproducibles. El aprovisionamiento de nube, la certificación de proveedores reales y la apertura pública se cierran en F09–F10.

## Contrato común

| Entorno | `APP_ENV` | Perfil / entorno EAS | Aplicación | Esquema de enlaces | OTP |
|---|---|---|---|---|---|
| Desarrollo | `development` | `development` / `development` | `com.viajaya.app.dev` | `viajaya-dev` | Simulado; autofill habilitado por defecto |
| Pruebas | `testing` | `preview` / `preview` | `com.viajaya.app.testing` | `viajaya-testing` | Simulado; autofill habilitado por defecto |
| Producción | `production` | `production` / `production` | `com.viajaya.app` | `viajaya` | Proveedor real; autofill de prueba prohibido |

`preview` es el nombre del perfil/entorno administrado por EAS para pruebas, no un cuarto entorno. `NODE_ENV` controla optimizaciones del compilador y no selecciona el entorno de negocio. El identificador técnico de pruebas usa `.testing`, conforme a la preferencia de código en inglés; el nombre visible sigue siendo **ViajaYa Pruebas**.

Backend valida desde `Settings`. Mobile valida durante la resolución de `app.config.ts` y nuevamente desde `src/core/config/env.ts`. Los módulos de la aplicación consumen `env`, sin leer variables de proceso directamente.

## Desarrollo en Windows

Usar Node.js 24.19.0 para reproducir las comprobaciones actuales, Python 3.13 y uv 0.12.12. `uv.lock` fija dependencias y hashes; incluye `tzdata` para que `America/La_Paz` funcione también en Windows.

Desde `backend/`:

```powershell
python -m pip install uv==0.12.12
uv sync --locked --extra dev
uv run --locked --no-sync python -m pytest -q
uv run --locked --no-sync python -m ruff check .
```

Si ya existe un backend usando `.venv`, preparar la verificación en otro entorno antes de sustituir dependencias:

```powershell
$env:UV_PROJECT_ENVIRONMENT = '.venv-f01'
uv sync --locked --extra dev
uv run --locked --no-sync python -m pytest -q
```

Desde `mobile/`:

```powershell
npm ci
npm test
npx tsc --noEmit
npm run lint
npm run verify:environments
npm run verify:environments:native
```

La verificación nativa genera copias aisladas bajo `local-files/phase01/`, omite archivos `.env` y utiliza configuración sintética. Comprueba los identificadores, esquemas y nombres realmente generados por Expo. No instala aplicaciones ni inicia emuladores. Generar el proyecto nativo no equivale a compilar y certificar un APK/AAB firmado en un teléfono.

Para arrancar el desarrollo, inspeccionar primero PostgreSQL, Redis, backend y Metro existentes. Si faltan servicios locales, usar `docker compose up -d db redis` desde la raíz. Aplicar migraciones únicamente sobre la base de desarrollo identificada. Desde backend, `uv run --locked --no-sync python -m uvicorn app.main:app --reload --host 0.0.0.0 --port 8000`; desde mobile, `npm start`. En teléfonos físicos, `API_URL` debe apuntar a la IP LAN del backend. Los `.env` privados existentes no se modifican automáticamente.

## Aislamiento y rechazo de configuraciones

- JWT incluye y exige `iss=viajaya:<APP_ENV>` y `aud=viajaya:mobile:<APP_ENV>`, tanto en access como refresh. Cada despliegue usa además su propio secreto. Un token de otro entorno se rechaza aunque por error se comparta una clave.
- Mobile declara `X-App-Environment` en todas las solicitudes HTTP, incluido login/refresh; el backend rechaza discrepancias antes de ejecutar la ruta e identifica su entorno en la respuesta. Es una protección contra errores de configuración, no una autenticación del binario. Clientes antiguos sin cabecera conservan compatibilidad; JWT y la política OTP del servidor siguen siendo obligatorios.
- **Transición de sesiones:** los tokens anteriores sin emisor/audiencia dejan de ser válidos. Al cargar esta versión será necesario iniciar sesión otra vez; no se modifican usuarios ni historial. La recuperación de sesión existente permite volver al acceso.
- Pruebas/producción exigen API HTTPS, CORS explícito, PostgreSQL remoto con nombre terminado en `_testing` o `_production`, claves no predeterminadas y namespaces Redis/storage correspondientes al entorno.
- Un namespace evita mezclar claves, pero **no reemplaza recursos físicos ni permisos separados**. F09 debe crear bases, cachés, almacenamiento y cuentas propias y comprobar que una operación sobre pruebas no afecte producción.
- Desarrollo/pruebas rechazan `OTP_MODE=provider` y cualquier `OTP_PROVIDER_API_KEY`; producción exige proveedor y rechaza `OTP_TEST_AUTOFILL=true`. En entornos bajos el autofill puede apagarse para probar errores, manteniendo OTP simulado.
- Pagos exigen `mock` en desarrollo, `sandbox` en pruebas y `live` en producción. Correo/push en ambientes bajos solo admiten `mock` o `restricted` con destinatarios explícitos; producción exige `live`.

**Límite de F01:** estos modos establecen contratos y validaciones de configuración. F02-A ya incorpora desafíos OTP simulados, verificación y un formulario reutilizable, comprobados en aislamiento. Su activación en el acceso unificado corresponde a F02-B; los adaptadores de pago a F07. Las fábricas/adaptadores deben consumir las reglas de entorno antes de cualquier llamada externa. F01 no envía SMS ni certifica proveedores. Estado y activación del OTP: `docs/implementation-plans/0010-phone-identity-and-otp.md`.

## Configuración y distribución móvil

Desarrollo conserva las variables públicas existentes, como `API_URL` y `GOOGLE_MAPS_API_KEY_ANDROID`. Pruebas utiliza exclusivamente `TESTING_API_URL`, `TESTING_GOOGLE_*`, `TESTING_FACEBOOK_APP_ID`, etc.; producción utiliza `PRODUCTION_*`. Una variante alojada nunca toma como respaldo las claves o la API local. Backend y servicios de proveedores conservan sus secretos fuera de mobile: `extra` y los binarios son públicos.

Los identificadores nativos y esquemas cambian por entorno. Cada aplicación debe registrarse con sus firmas y credenciales propias en Google/Facebook/Maps. Al generar una variante nueva hace falta un nuevo binario. Si se cambia de variante con directorios nativos previos, Expo requiere regenerarlos; evitar borrar trabajo nativo manual y seguir el procedimiento de CNG. [Variantes de aplicación de Expo](https://docs.expo.dev/build-reference/variants/).

Los perfiles declaran canales `development`, `testing` y `production`, y la configuración separa `runtimeVersion`. **OTA permanece deshabilitado**: no se habilita un mecanismo de actualización sin certificar compatibilidad, destino y rollback en F09. La variante productiva no tiene un selector de API ni un distintivo de pruebas. Las otras muestran su entorno sin interceptar los controles.

### Estado de instalación en esta PC

Se generaron y verificaron APK firmados de **ViajaYa Desarrollo** y **ViajaYa Pruebas** en EAS. Desarrollo usa Metro y el usuario confirmó el login en su teléfono. Pruebas incorpora el JavaScript en el APK y abre la aplicación directamente; el usuario confirmó el login y el distintivo **Pruebas**. Los enlaces, QR, cuentas ficticias y comprobaciones están en `local-files/phase01/instalacion-android.md`; las credenciales locales no se incluyen en Git.

El backend temporal de Pruebas corre en el proyecto Docker `viajaya-testing-local`, con PostgreSQL, Redis y JWT separados de Desarrollo. Un túnel de Cloudflare proporciona HTTPS mientras esta PC, Docker y el túnel estén activos. No requiere contratar un servidor. Reiniciar el túnel cambia su URL y obliga a recompilar el APK con la nueva dirección; los datos persisten en su volumen de PostgreSQL. Este entorno temporal no cierra los requisitos de alojamiento permanente, disponibilidad ni operación de F09.

La variable de Maps de Pruebas se configuró explícitamente con la clave pública móvil existente. La separación de claves de Google y la certificación de sus restricciones por paquete y firma siguen pendientes. El APK instalado corresponde a F01. Ambas API ya tienen F02-B activado y el acceso por teléfono/sesiones pasó la verificación local. Desarrollo está disponible por Wi-Fi con Metro. El usuario autorizó compilar el APK de Pruebas, pero dos túneles de Cloudflare devolvieron dominios sin DNS válido; la distribución espera recuperar HTTPS. Se propuso ngrok gratuito con dominio asignado estable, sujeto a una cuenta del usuario. El estado se registra en `docs/implementation-plans/0010-phone-identity-and-otp.md`.

## Imagen y despliegue preparados

El Dockerfile fija Python y uv por digest y consume `uv.lock`. La imagen de runtime ejecuta un solo worker como UID 10001, excluye archivos `.env` y no aplica migraciones automáticamente. Su entorno predeterminado es producción y rechaza arrancar con la configuración insegura por defecto. Las dependencias de pruebas quedan fuera del runtime.

Desde la raíz:

```powershell
docker build --target runtime --tag viajaya-phase1:runtime backend
```

Desde backend:

```powershell
uv run --locked --no-sync python -m scripts.smoke_environment_image
```

La prueba crea red, PostgreSQL y API propios, aplica migraciones en su base desechable, comprueba `/health/ready`, registro, refresh, tokens cruzados y usuario no root. Retira únicamente los contenedores que ella creó. No usa puertos fijos ni la base de desarrollo.

`ops/compose.hosted.yml` define API y un proceso de migración separado para usar detrás de un proxy HTTPS. Requiere `VIAJAYA_DEPLOYMENT_ENV`, `VIAJAYA_API_IMAGE`, `VIAJAYA_BACKEND_ENV_FILE` y `VIAJAYA_API_PORT`. Pruebas/producción utilizan archivos privados, proyectos y puertos distintos. El valor de imagen debe ser el digest certificado del registro; promover la misma imagen entre entornos. Las plantillas `ops/environments/*.env.example` contienen marcadores y no son credenciales válidas.

Esta definición no contrata infraestructura ni configura Render automáticamente. En F09 se elegirá/aprovisionará el alojamiento, conectará PostgreSQL/Redis/storage y certificará TLS, permisos, migración única, rollback y operación. Conservar el rollout técnico existente de outbox/presencia/scheduler; no activar múltiples workers simplemente por tener dos entornos.

## Verificación continua

CI consume el lockfile del backend y `npm ci`. Mantiene pruebas rápidas, contratos OpenAPI/realtime, PostgreSQL/Redis, tipos y lint; agrega configuración/JWT en Windows, generación de las tres variantes y construcción/smoke de la imagen. Ejecutar los comandos localmente verifica sus componentes; la ejecución de GitHub Actions se confirma solo después de publicar la rama.

La evidencia y los pendientes de F01 se registran en `docs/implementation-plans/0009-environment-foundation.md`.
