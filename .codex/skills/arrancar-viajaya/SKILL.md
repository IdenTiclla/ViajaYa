---
name: arrancar-viajaya
description: Levanta el entorno de desarrollo del monorepo ViajaYa (PostgreSQL en Docker + backend FastAPI + app Expo/React Native) y, opcionalmente, un emulador Android con la app instalada, verificando estado antes de actuar para no reiniciar nada que ya corre ni lanzar procesos que van a chocar. Úsala SIEMPRE que el usuario pida arrancar, iniciar, levantar, correr, start, run o poner en marcha el proyecto, la app, el backend, el servidor, la API o Expo — incluso si no nombra "ViajaYa" explícitamente. Úsala TAMBIÉN cuando pidan arrancar/abrir un emulador, el emulador del pasajero o del conductor, o "ver la app en el emulador", así como cuando pidan cambiar de rol, cambiar de emulador, "cámbiame a conductor/pasajero", o matar/cerrar/apagar el emulador. También cuando pregunten "¿cómo corro esto?" o quieran ver la app andando.
---

# Arrancar ViajaYa

Levanta el stack de desarrollo del monorepo ViajaYa. El monorepo tiene tres piezas
que se levantan por separado:

1. **Base de datos** — PostgreSQL 16 en Docker (`docker compose`, servicio `db`).
2. **Backend** — FastAPI en `backend/` (Python 3.11+, venv, uvicorn en :8000).
3. **Mobile** — Expo + React Native en `mobile/` (npm, `npx expo start`).

Y una cuarta pieza **opcional, solo bajo pedido explícito** (Paso 3d):

4. **Emulador Android** — un teléfono virtual con la app instalada. Pesa ~4.7 GB de RAM,
   por eso NO forma parte del arranque por defecto; solo se levanta si el usuario lo pide.

La raíz del repo es `/home/iden/Desktop/ViajaYa`. Todos los paths relativos salen de ahí.

## Principio rector: verifica antes de actuar

El usuario pide "arranca el proyecto" casi siempre **sin recordar** qué dejó corriendo la
última vez. Por eso lo primero siempre es inspeccionar el estado real y, a partir de eso,
hacer solo lo que falta. Reiniciar el backend o recargar la DB cuando ya están sanos
genera demoras, pierde estado en memoria (sesiones, datos en caliente) y confunde al
usuario que pensaba que "ya estaba andando".

Regla: **nunca lances un proceso que ya está vivo, y nunca asumas que falta algo sin
comprobarlo.** Si todo está listo, dilo claramente y no ejecutes nada.

## Paso 1 — Diagnosticar el estado actual

Antes de cualquier comando, revisa estas cuatro cosas en una sola pasada (lanza los
chequeos en paralelo):

1. **DB corriendo** → `docker ps --filter name=viajaya_db --format '{{.Names}} {{.Status}}'`.
   Si muestra `viajaya_db ... healthy`, la DB está lista.
2. **Backend en :8000** → `curl -fsS -o /dev/null http://localhost:8000/docs && echo UP || echo DOWN`.
   El `DOWN` es lo normal si aún no levantaste.
3. **Puertos ocupados** → `ss -ltnp 2>/dev/null | grep -E ':(5432|8000|8081|19000|19006) '`.
   Útil para detectar procesos que NO son los nuestros pero ocupan el mismo puerto.
4. **Prerrequisitos del repo** →
   - `backend/.env` existe (si no, hay que copiarlo de `.env.example`).
   - `backend/.venv/` existe **y su intérprete es válido** (ver Paso 1b). Si no existe
     o está roto, hay que (re)crearlo con `uv`.
   - `mobile/.env` existe.
   - `mobile/node_modules/` existe (si no, falta `npm install`).
5. **(Solo si van a usar emulador)** Emuladores ya corriendo →
   `~/Android/Sdk/platform-tools/adb devices | grep emulator`. Si ya hay uno vivo, NO
   lances otro (cada emulador pesa ~4.7 GB; ver Paso 3d).

### Paso 1b — Verificar que el venv del backend no esté roto

El sistema no tiene `python3-venv` y el snap de VSCode fuerza
`XDG_DATA_HOME=/home/iden/snap/code/<rev>/.local/share`, así que los venvs creados
sin cuidar las rutas terminan apuntando a un Python que muere cuando VSCode actualiza
el snap. **Siempre** verifica el intérprete antes de activar:

```bash
readlink -f /home/iden/Desktop/ViajaYa/backend/.venv/bin/python
```

Si resuelve a algo bajo `/home/iden/snap/code/...` o a una ruta que no existe,
el venv está **peligroso/roto** — bórralo y recréalo con `uv` como indica el Paso 3b.
Si resuelve a `/home/iden/.local/share/uv/python/...` (fuera del snap), está sano.

Reporta al usuario un resumen breve del estado (qué está vivo, qué falta) **antes** de
empezar a levantar. Ejemplo: "DB ya está healthy, backend caído, falta `mobile/.env`".

## Paso 2 — Decidir alcance

Si el usuario pidió todo ("arranca el proyecto"), levanta los tres primeros (db, backend,
mobile). Si pidió uno ("levanta solo el backend"), respétalo. Si detectas que algo ya está
corriendo y sano, **omítelo** y avisa que se deja como está.

El **emulador (3d) es aparte**: solo entra en el alcance si el usuario lo menciona
explícitamente ("arranca el emulador", "abre la app en el emulador", "el emulador del
conductor"). "Arranca el proyecto" a secas **no** levanta emulador.

## Paso 3 — Levantar por pieza

Lanza cada pieza **en segundo plano** (`run_in_background: true` en Bash, o el patrón
equivalente) para que las tres queden vivas a la vez, salvo que el usuario quiera ver
el log en foreground.

### 3a. Base de datos

```bash
cd /home/iden/Desktop/ViajaYa && docker compose up -d db
```

Espera a que esté `healthy` antes de continuar con el backend (el contenedor tiene un
healthcheck configurado; puedes sondearlo con `docker inspect --format '{{.State.Health.Status}}' viajaya_db`
hasta que diga `healthy`).

### 3b. Backend

Solo si `:8000` estaba `DOWN`:

```bash
cd /home/iden/Desktop/ViajaYa/backend
source .venv/bin/activate          # si falta o está roto (Paso 1b): recrear con uv (ver abajo)
alembic upgrade head               # aplicar migraciones pendientes
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

#### (Re)crear el venv con uv — cuando `.venv` no existe o está roto

El sistema **no tiene** `python3-venv`, así que `python3 -m venv` falla. Usa `uv`
instalado **fuera del snap** (en `~/.local`), con `XDG_DATA_HOME` y
`UV_PYTHON_INSTALL_DIR` apuntando también fuera del snap, para que el intérprete
sobreviva a las actualizaciones de VSCode:

```bash
# 1) Asegurar uv en ~/.local (solo si no existe /home/iden/.local/uv)
export XDG_DATA_HOME=/home/iden/.local/share
export UV_INSTALL_DIR=/home/iden/.local
[ -x /home/iden/.local/uv ] || curl -LsSf https://astral.sh/uv/install.sh | sh
ln -sf /home/iden/.local/uv  /home/iden/.local/bin/uv
ln -sf /home/iden/.local/uvx /home/iden/.local/bin/uvx

# 2) Recrear venv con Python 3.12 gestionado por uv (fuera del snap)
export UV_PYTHON_INSTALL_DIR=/home/iden/.local/share/uv/python
cd /home/iden/Desktop/ViajaYa/backend
rm -rf .venv
/home/iden/.local/uv venv --python 3.12 .venv
source .venv/bin/activate
/home/iden/.local/uv pip install -e ".[dev]"
```

Consideraciones:
- Si no existe `backend/.env`, cópialo de `.env.example` y avisa al usuario que debe
  editar `JWT_SECRET` y (si va a usar OAuth) las credenciales de Google/Facebook.
- `alembic upgrade head` corre cada vez: es idempotente y asegura el esquema al día.
  No hay necesidad de saltárselo "porque ya está aplicado".
- El Swagger queda en `http://localhost:8000/docs`.

### 3c. Mobile

Solo si el usuario también quiere la app:

```bash
cd /home/iden/Desktop/ViajaYa/mobile
npm install                        # solo si falta node_modules
npx expo start
```

Consideraciones:
- Si no existe `mobile/.env`, cópialo de `.env.example`. **Punto crítico**: `API_URL`
  debe apuntar a la **IP de la LAN** del backend (no `localhost`), porque la app corre
  en un dispositivo/emulador que no puede resolver `localhost` hacia la máquina host.
  Obtén la IP con `hostname -I` y propón `http://<IP>:8000/api/v1`.
- `expo start` abre un servidor de dev en :8081 (y usa :19000/:19006). Mantiene el
  proceso en foreground por naturaleza; lánzalo en background y revisa el log para
  confirmar que arrancó.

### 3d. Emulador Android (opcional — SOLO si lo piden)

Solo si el usuario pidió explícitamente un emulador. La app **NO usa Expo Go**: tiene
módulos nativos (Maps, OAuth), así que corre sobre un **dev-build** (APK propio). Requiere
la DB + backend + Expo (3a-3c) arriba, porque la app pide su JavaScript a Metro en vivo.

**Elegir el AVD por rol** (hay dos, ambos Pixel 6 / Android 14):
- "conductor" → `viajaya_conductor` (puerto 5556 → device `emulator-5556`)
- "pasajero" o sin rol → `viajaya_pasajero` (puerto 5554 → device `emulator-5554`)

**Nunca levantes los dos a la vez salvo pedido explícito.** Esta máquina tiene 14 GB y un
solo emulador ya llena el swap; dos provocan thrashing/OOM (VSCode se congela). Si piden el
segundo, avisa del riesgo y ofrece la alternativa: 1 emulador + celular físico con el APK.

**Toolchain** (instalado fuera del snap, como el venv del backend — ver Paso 1b):
JDK 17 en `~/.local/jdk-17`, Android SDK en `~/Android/Sdk`. Exporta siempre este entorno:

```bash
export JAVA_HOME=~/.local/jdk-17
export ANDROID_HOME=~/Android/Sdk
export ANDROID_SDK_ROOT=~/Android/Sdk
export PATH="$ANDROID_HOME/emulator:$ANDROID_HOME/platform-tools:$JAVA_HOME/bin:$PATH"
export DISPLAY=:0   # la ventana del emulador se abre en el escritorio del usuario
```

**1) Verifica que no esté ya corriendo** (`adb devices`). Si el device del AVD elegido ya
figura, salta al paso 3 (no relances).

**2) Enciende el emulador** (background) y espera el boot completo antes de instalar/abrir:

```bash
# pasajero: -avd viajaya_pasajero -port 5554   ·   conductor: -avd viajaya_conductor -port 5556
emulator -avd viajaya_pasajero -port 5554 -gpu auto -no-snapshot -no-boot-anim &
adb -s emulator-5554 wait-for-device
until [ "$(adb -s emulator-5554 shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" = "1" ]; do sleep 3; done
```

**3) Instala/abre la app.** El APK ya compilado (89 MB) vive en:
`mobile/android/app/build/outputs/apk/debug/app-debug.apk`.

```bash
# instala si el paquete com.viajaya.app no está (adb shell pm list packages | grep viaja)
adb -s emulator-5554 install -r /home/iden/Desktop/ViajaYa/mobile/android/app/build/outputs/apk/debug/app-debug.apk
# abre apuntando a Metro (usa la IP LAN de mobile/.env, no localhost)
adb -s emulator-5554 shell am start -a android.intent.action.VIEW \
  -d "exp+viajaya://expo-development-client/?url=http%3A%2F%2F<IP_LAN>%3A8081"
```

Al abrir aparece el "developer menu" del dev-client: ciérralo tocando **Continue**
(`adb -s emulator-5554 shell input tap <x> <y>`, o dilo al usuario). Verifica con una
captura: `adb -s emulator-5554 exec-out screencap -p > /tmp/app.png`.

**Si el APK NO existe** (repo recién clonado, sin `mobile/android/`): hay que compilar el
dev-build una vez — `cd mobile && npx expo run:android --no-bundler` (prebuild + Gradle,
varios minutos la 1ª vez; reusa el Metro ya corriendo). **No** pases `--device <serial>`
(esta versión de Expo no lo matchea; con un solo emulador conectado lo toma solo). Solo se
recompila al cambiar código nativo, dependencias nativas o claves/permisos de `app.json`;
los cambios de JS/TS los sirve Metro sin recompilar.

Cuentas de prueba del seed (contraseña común `ViajaYa1234#`): pasajero
`passenger1@viajaya.com`, conductor taxi `driver.auto1@viajaya.com`. Sembrar con
`python -m scripts.seed` (Paso 3b, venv activo) si faltan.

### 3e. Cambiar de rol / apagar el emulador

Como esta máquina aguanta **un solo emulador a la vez**, "cambiar de rol" = apagar el
que corre y abrir el del otro rol. No hace falta que el usuario diga los pasos: si pide
"cámbiame a conductor" y hay un `viajaya_pasajero` vivo, mata ese y levanta el conductor.

**1) Identifica y mata la instancia actual** (limpio, no `kill -9`):

```bash
adb devices                                   # ver qué emulator-XXXX está vivo
adb -s emulator-5554 emu kill                 # apaga el pasajero (o 5556 para el conductor)
```

Espera a que desaparezca de `adb devices` (1-2 s) antes de arrancar el otro, para liberar
la RAM. Si el usuario solo pidió **apagar** (no cambiar), termina aquí y confirma.

**2) Levanta el otro rol** siguiendo el Paso 3d con el AVD correspondiente. Cambiar de
rol es **rápido**: el APK ya quedó instalado dentro de cada AVD la primera vez, así que
es solo encender + abrir por deep link (sin `install` ni recompilar). db/backend/Expo
siguen sirviendo a ambos por igual, no los toques.

**Ojo — dos roles a la vez:** si el usuario NO quiere cambiar sino **tener los dos**
(pasajero y conductor simultáneos, p. ej. para probar una oferta en vivo), es el caso de
riesgo de RAM del Paso 3d: avísale y ofrece 1 emulador + celular físico con el mismo APK.

## Paso 4 — Confirmar que quedó andando

Después de levantar, verifica con una sola pasada:

- DB: `docker ps --filter name=viajaya_db` muestra `healthy`.
- Backend: `curl -fsS http://localhost:8000/docs` responde (o `/health` si existe).
- Mobile: el log de Expo muestra el QR / "Metro waiting on".
- Emulador (si se levantó): `adb devices` lista el device y una captura muestra la app
  cargada (no la pantalla de bundling). Vigila la RAM con `free -h`.

Entrega al usuario un resumen conciso con: qué quedó corriendo, en qué puertos, y las
URLs útiles (`/docs`, el QR de Expo, y qué AVD/device quedó abierto). Si algo falló,
muestra el error concreto y propón el fix en lugar de reintentar a ciegas.

## Cuándo NO usar esta skill

- El usuario solo quiere **correr tests o lint** (`pytest`, `ruff`, `tsc`, `npm run lint`).
  Eso no levanta el stack; hazlo directamente.
- El usuario está **depurando un proceso que ya corre** (ver logs, reiniciar uno solo).
  En ese caso opera sobre ese proceso, no releves todo el stack.
- El usuario quiere **deployar a producción**. Esto es solo para desarrollo local.
