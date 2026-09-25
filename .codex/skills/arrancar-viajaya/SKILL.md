---
name: arrancar-viajaya
description: Brings up the ViajaYa monorepo development environment (PostgreSQL in Docker + FastAPI backend + Expo/React Native app) and, optionally, an Android emulator with the app installed, checking state before acting so nothing already running is restarted and no clashing processes are launched. ALWAYS use it when the user asks to start, launch, bring up, run or boot the project, the app, the backend, the server, the API or Expo (e.g. "arranca", "inicia", "levanta", "corre", "pon en marcha") — even if they do not name "ViajaYa" explicitly. ALSO use it when they ask to start/open an emulator, the passenger or driver emulator, or "ver la app en el emulador", as well as when they ask to switch role, switch emulator, "cámbiame a conductor/pasajero", or kill/close/shut down the emulator. Also when they ask "¿cómo corro esto?" or want to see the app running.
---

# Start ViajaYa

Brings up the ViajaYa monorepo development stack. The monorepo has three pieces
that are started separately:

1. **Database** — PostgreSQL 16 in Docker (`docker compose`, service `db`).
2. **Backend** — FastAPI in `backend/` (Python 3.11+, venv, uvicorn on :8000).
3. **Mobile** — Expo + React Native in `mobile/` (npm, `npx expo start`).

And a fourth **optional piece, only on explicit request** (Step 3d):

4. **Android emulator** — a virtual phone with the app installed. It uses ~4.7 GB of RAM,
   which is why it is NOT part of the default startup; it is only started if the user asks.

The repo root is `/home/iden/Desktop/ViajaYa`. All relative paths start from there.

## Guiding principle: check before acting

The user asks to "start the project" almost always **without remembering** what they left running
last time. That is why the first thing is always to inspect the real state and, from that,
do only what is missing. Restarting the backend or reloading the DB when they are already healthy
causes delays, loses in-memory state (sessions, hot data) and confuses the
user who thought it "was already running".

Rule: **never launch a process that is already alive, and never assume something is missing without
checking it.** If everything is ready, say so clearly and run nothing.

## Step 1 — Diagnose the current state

Before any command, check these four things in a single pass (run the
checks in parallel):

1. **DB running** → `docker ps --filter name=viajaya_db --format '{{.Names}} {{.Status}}'`.
   If it shows `viajaya_db ... healthy`, the DB is ready.
2. **Backend on :8000** → `curl -fsS -o /dev/null http://localhost:8000/docs && echo UP || echo DOWN`.
   `DOWN` is normal if you have not started it yet.
3. **Busy ports** → `ss -ltnp 2>/dev/null | grep -E ':(5432|8000|8081|19000|19006) '`.
   Useful to detect processes that are NOT ours but take the same port.
4. **Repo prerequisites** →
   - `backend/.env` exists (if not, it must be copied from `.env.example`).
   - `backend/.venv/` exists **and its interpreter is valid** (see Step 1b). If it does not exist
     or is broken, it must be (re)created with `uv`.
   - `mobile/.env` exists.
   - `mobile/node_modules/` exists (if not, `npm install` is missing).
5. **(Only if an emulator will be used)** Emulators already running →
   `~/Android/Sdk/platform-tools/adb devices | grep emulator`. If one is already alive, do NOT
   launch another (each emulator uses ~4.7 GB; see Step 3d).

### Step 1b — Check that the backend venv is not broken

The system does not have `python3-venv` and the VSCode snap forces
`XDG_DATA_HOME=/home/iden/snap/code/<rev>/.local/share`, so venvs created
without care for the paths end up pointing to a Python that dies when VSCode updates
the snap. **Always** check the interpreter before activating:

```bash
readlink -f /home/iden/Desktop/ViajaYa/backend/.venv/bin/python
```

If it resolves to something under `/home/iden/snap/code/...` or to a path that does not exist,
the venv is **dangerous/broken** — delete it and recreate it with `uv` as Step 3b says.
If it resolves to `/home/iden/.local/share/uv/python/...` (outside the snap), it is healthy.

Report a short summary of the state to the user (what is alive, what is missing) **before**
starting to bring things up. Example: "DB is already healthy, backend down, `mobile/.env` missing".

## Step 2 — Decide the scope

If the user asked for everything ("start the project"), bring up the first three (db, backend,
mobile). If they asked for one ("start only the backend"), respect that. If you detect that something is already
running and healthy, **skip it** and say it is left as is.

The **emulator (3d) is separate**: it is only in scope if the user mentions it
explicitly ("start the emulator", "open the app on the emulator", "the driver's
emulator"). A bare "start the project" does **not** bring up an emulator.

## Step 3 — Bring up each piece

Launch each piece **in the background** (`run_in_background: true` in Bash, or the
equivalent pattern) so all three stay alive at the same time, unless the user wants to see
the log in the foreground.

### 3a. Database

```bash
cd /home/iden/Desktop/ViajaYa && docker compose up -d db
```

Wait for it to be `healthy` before continuing with the backend (the container has a
configured healthcheck; you can poll it with `docker inspect --format '{{.State.Health.Status}}' viajaya_db`
until it says `healthy`).

### 3b. Backend

Only if `:8000` was `DOWN`:

```bash
cd /home/iden/Desktop/ViajaYa/backend
source .venv/bin/activate          # if missing or broken (Step 1b): recreate with uv (see below)
alembic upgrade head               # apply pending migrations
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

#### (Re)create the venv with uv — when `.venv` does not exist or is broken

The system **does not have** `python3-venv`, so `python3 -m venv` fails. Use `uv`
installed **outside the snap** (in `~/.local`), with `XDG_DATA_HOME` and
`UV_PYTHON_INSTALL_DIR` also pointing outside the snap, so the interpreter
survives VSCode updates:

```bash
# 1) Ensure uv in ~/.local (only if /home/iden/.local/uv does not exist)
export XDG_DATA_HOME=/home/iden/.local/share
export UV_INSTALL_DIR=/home/iden/.local
[ -x /home/iden/.local/uv ] || curl -LsSf https://astral.sh/uv/install.sh | sh
ln -sf /home/iden/.local/uv  /home/iden/.local/bin/uv
ln -sf /home/iden/.local/uvx /home/iden/.local/bin/uvx

# 2) Recreate the venv with Python 3.12 managed by uv (outside the snap)
export UV_PYTHON_INSTALL_DIR=/home/iden/.local/share/uv/python
cd /home/iden/Desktop/ViajaYa/backend
rm -rf .venv
/home/iden/.local/uv venv --python 3.12 .venv
source .venv/bin/activate
/home/iden/.local/uv pip install -e ".[dev]"
```

Considerations:
- If `backend/.env` does not exist, copy it from `.env.example` and tell the user they must
  edit `JWT_SECRET` and (if they will use OAuth) the Google/Facebook credentials.
- `alembic upgrade head` runs every time: it is idempotent and keeps the schema up to date.
  There is no need to skip it "because it is already applied".
- Swagger is at `http://localhost:8000/docs`.

### 3c. Mobile

Only if the user also wants the app:

```bash
cd /home/iden/Desktop/ViajaYa/mobile
npm install                        # only if node_modules is missing
npx expo start
```

Considerations:
- If `mobile/.env` does not exist, copy it from `.env.example`. **Critical point**: `API_URL`
  must point to the backend's **LAN IP** (not `localhost`), because the app runs
  on a device/emulator that cannot resolve `localhost` to the host machine.
  Get the IP with `hostname -I` and propose `http://<IP>:8000/api/v1`.
- `expo start` opens a dev server on :8081 (and uses :19000/:19006). It keeps the
  process in the foreground by nature; launch it in the background and check the log to
  confirm it started.

### 3d. Android emulator (optional — ONLY if asked)

Only if the user explicitly asked for an emulator. The app does **NOT use Expo Go**: it has
native modules (Maps, OAuth), so it runs on a **dev build** (its own APK). It requires
DB + backend + Expo (3a-3c) up, because the app requests its JavaScript from Metro live.

**Choose the AVD by role** (there are two, both Pixel 6 / Android 14):
- "driver" ("conductor") → `viajaya_conductor` (port 5556 → device `emulator-5556`)
- "passenger" ("pasajero") or no role → `viajaya_pasajero` (port 5554 → device `emulator-5554`)

**Never bring up both at the same time unless explicitly asked.** This machine has 14 GB and a
single emulator already fills the swap; two cause thrashing/OOM (VSCode freezes). If they ask for the
second one, warn about the risk and offer the alternative: 1 emulator + a physical phone with the APK.

**Toolchain** (installed outside the snap, like the backend venv — see Step 1b):
JDK 17 in `~/.local/jdk-17`, Android SDK in `~/Android/Sdk`. Always export this environment:

```bash
export JAVA_HOME=~/.local/jdk-17
export ANDROID_HOME=~/Android/Sdk
export ANDROID_SDK_ROOT=~/Android/Sdk
export PATH="$ANDROID_HOME/emulator:$ANDROID_HOME/platform-tools:$JAVA_HOME/bin:$PATH"
export DISPLAY=:0   # the emulator window opens on the user's desktop
```

**1) Check it is not already running** (`adb devices`). If the chosen AVD's device is already
listed, skip to step 3 (do not relaunch).

**2) Start the emulator** (background) and wait for the full boot before installing/opening:

```bash
# passenger: -avd viajaya_pasajero -port 5554   ·   driver: -avd viajaya_conductor -port 5556
emulator -avd viajaya_pasajero -port 5554 -gpu auto -no-snapshot -no-boot-anim &
adb -s emulator-5554 wait-for-device
until [ "$(adb -s emulator-5554 shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" = "1" ]; do sleep 3; done
```

**3) Install/open the app.** The already built APK (89 MB) lives in:
`mobile/android/app/build/outputs/apk/debug/app-debug.apk`.

```bash
# install if the com.viajaya.app package is missing (adb shell pm list packages | grep viaja)
adb -s emulator-5554 install -r /home/iden/Desktop/ViajaYa/mobile/android/app/build/outputs/apk/debug/app-debug.apk
# open it pointing to Metro (use the LAN IP from mobile/.env, not localhost)
adb -s emulator-5554 shell am start -a android.intent.action.VIEW \
  -d "exp+viajaya://expo-development-client/?url=http%3A%2F%2F<LAN_IP>%3A8081"
```

When it opens, the dev-client "developer menu" appears: close it by tapping **Continue**
(`adb -s emulator-5554 shell input tap <x> <y>`, or tell the user). Verify with a
screenshot: `adb -s emulator-5554 exec-out screencap -p > /tmp/app.png`.

**If the APK does NOT exist** (freshly cloned repo, without `mobile/android/`): the
dev build has to be compiled once — `cd mobile && npx expo run:android --no-bundler` (prebuild + Gradle,
several minutes the first time; reuses the Metro already running). Do **not** pass `--device <serial>`
(this Expo version does not match it; with a single emulator connected it picks it up by itself). It is only
rebuilt when native code, native dependencies or `app.json` keys/permissions change;
JS/TS changes are served by Metro without rebuilding.

Seed test accounts (sign in with phone + simulated OTP): passengers `+59170000001/2`,
taxi drivers `+59170000011/12`, moto drivers `+59170000021/22`, moving truck `+59170000031`. Seed with
`python -m scripts.seed` (Step 3b, venv active) if they are missing.

### 3e. Switch role / shut down the emulator

Since this machine handles **a single emulator at a time**, "switching role" = shutting down the
one running and opening the other role's. The user does not need to spell out the steps: if they ask
"cámbiame a conductor" and a `viajaya_pasajero` is alive, kill it and bring up the driver.

**1) Identify and kill the current instance** (cleanly, not `kill -9`):

```bash
adb devices                                   # see which emulator-XXXX is alive
adb -s emulator-5554 emu kill                 # shuts down the passenger (or 5556 for the driver)
```

Wait for it to disappear from `adb devices` (1-2 s) before starting the other, to free
RAM. If the user only asked to **shut down** (not switch), stop here and confirm.

**2) Bring up the other role** following Step 3d with the corresponding AVD. Switching
role is **fast**: the APK was already installed inside each AVD the first time, so
it is only booting + opening by deep link (no `install` or rebuild). db/backend/Expo
keep serving both equally, do not touch them.

**Watch out — two roles at once:** if the user does NOT want to switch but to **have both**
(passenger and driver simultaneously, e.g. to test an offer live), it is the RAM
risk case of Step 3d: warn them and offer 1 emulator + a physical phone with the same APK.

## Step 4 — Confirm it is running

After bringing things up, verify in a single pass:

- DB: `docker ps --filter name=viajaya_db` shows `healthy`.
- Backend: `curl -fsS http://localhost:8000/docs` responds (or `/health` if it exists).
- Mobile: the Expo log shows the QR / "Metro waiting on".
- Emulator (if it was started): `adb devices` lists the device and a screenshot shows the app
  loaded (not the bundling screen). Watch RAM with `free -h`.

Give the user a concise summary with: what is running, on which ports, and the
useful URLs (`/docs`, the Expo QR, and which AVD/device was opened). If something failed,
show the concrete error and propose the fix instead of retrying blindly.

## When NOT to use this skill

- The user only wants to **run tests or lint** (`pytest`, `ruff`, `tsc`, `npm run lint`).
  That does not bring up the stack; do it directly.
- The user is **debugging a process that is already running** (see logs, restart just one).
  In that case operate on that process, do not bring up the whole stack again.
- The user wants to **deploy to production**. This is only for local development.
