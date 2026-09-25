# Local environments and operation scripts

**Current policy (2026-09-19):** we only use **Development**. **Testing (`testing`/`preview`/staging) is temporarily deprecated**: do not start, deploy or produce deliveries for that environment. Production remains a future goal. Previous configurations are kept for reference; automated tests and disposable CI databases still apply.

How to bring up Development on a new machine and verify it. The Testing procedures further below are an inactive historical reference.
The scripts live in `ops/scripts/`; the artifacts they generate (private state, backups,
APKs, reports) stay outside the repository.

## Requirements

| Tool | Version | What for |
|---|---|---|
| Node | **24.19.0** (see `.node-version`) | Metro, EAS and the `mobile/` tests |
| Python | 3.13 with the `backend/` venv | Backend and these scripts |
| Docker | Desktop or Engine | PostgreSQL, Redis and the API image |
| ngrok | optional | Publish Testing over HTTPS |
| Android build-tools | optional, 36.0.0 | Verify a downloaded APK |

With Node 22, 7 `mobile/` test files fail because of `module.registerHooks`. It is not a
code failure: use the pinned version.

The scripts depend on `httpx`, `websockets` and `python-dotenv`, already included in the
backend's development dependencies.

## First time on a machine

```bash
git clone https://github.com/IdenTiclla/ViajaYa.git && cd ViajaYa

# Backend
cd backend && uv sync && cp .env.example .env      # edit JWT_SECRET and credentials
cd ..

# Mobile
cd mobile && npm install && cp .env.example .env   # API_URL = LAN IP, Maps/OAuth keys
cd ..
```

In `mobile/.env`, `API_URL` must point to this machine's LAN IP (`ipconfig` or
`ip addr`), not to `localhost`: the phone needs to reach it. `verify_apk.py development`
compares the APK against that same value.

**What to bring from the previous machine**, if there is one: `private-state.json` and the
PostgreSQL dumps. None of that can be regenerated from the repository. Without the private state,
the previous Testing database becomes inaccessible and a new environment has to be created; without the
dumps, the accounts and history are lost.

**What you do not need to bring:** the project variables in EAS, including `TESTING_API_URL`,
live on the Expo server and any machine with `eas login` sees them.

## Where unversioned things are stored

By default everything hangs from `local-files/`, ignored by git. Each path can be moved with
an environment variable:

| Variable | Default value | What it is |
|---|---|---|
| `VIAJAYA_WORK_DIR` | `local-files/` | Root of local artifacts |
| `VIAJAYA_TESTING_STATE` | `<work>/phase01/testing/private-state.json` | Testing private state: passwords, JWT secret, public URL |
| `VIAJAYA_APK_DIR` | `<work>/phase01/apks` | Downloaded APKs |
| `VIAJAYA_ANDROID_BUILD_TOOLS` | `<work>/tools/android/build-tools-36.0.0/android-16` | `aapt2` and `apksigner` |
| `VIAJAYA_EAS_COMMAND` | `eas` from PATH, or `npx --yes eas-cli` | How to invoke the EAS CLI |
| `VIAJAYA_DEVELOPMENT_ORIGIN` | `http://127.0.0.1:8000` | Development API |
| `VIAJAYA_TESTING_ORIGIN` | `http://127.0.0.1:8001` | Testing API before the tunnel |
| `VIAJAYA_DEVELOPMENT_API_URL` | `API_URL` from `mobile/.env` | URL embedded in the Development APK |
| `VIAJAYA_API_IMAGE` | `viajaya-phase2:runtime` | Image to promote in Testing |
| `VIAJAYA_SEED_PASSWORD` | `ViajaYa1234#` | Password of the seeded accounts |

**The private state cannot be recovered from the repository.** If you lose it, the existing
Testing database becomes inaccessible: the environment has to be recreated and seeded again.
Back it up together with your dumps.

## Development

```bash
docker compose up -d db redis
cd backend && alembic upgrade head
APP_ENV=development PHONE_OTP_ENABLED=true \
  python -m uvicorn app.main:app --reload --host 0.0.0.0 --port 8000

cd ../mobile && APP_ENV=development npx expo start --host lan
```

The Development app is a *development client*: it does not carry the code inside, it downloads it from
Metro. If you see "connecting to the development server", Metro is not running. It only needs to be
rebuilt when a native library is added.

`API_URL` in `mobile/.env` must point to this machine's LAN IP, not to `localhost`.

## Testing

Disposable, isolated environment: its own database, Redis, JWT secret and accounts.

```bash
# 1) API image
cd backend && docker build --target runtime -t viajaya-phase1:runtime .

# 2) State and Compose definition (the first time it generates new passwords)
python ops/scripts/manage_testing.py prepare

# 3) Infrastructure, migrations and API
docker compose -f local-files/phase01/testing/compose.json \
  -p viajaya-testing-local up -d testing-database testing-cache
python ops/scripts/manage_testing.py start-api
python ops/scripts/manage_testing.py seed      # fictitious accounts
python ops/scripts/manage_testing.py status
```

`prepare` generates new passwords and JWT secret the first time, and does not touch them again
in later runs. It does not need the cloudflared image: if it is missing, the environment is
generated without a tunnel service, which is correct when the tunnel runs on the host.

`start-api` requires the state to have an `api_url`, the public URL the
APK will be built with. It is set without editing the JSON by hand:

```bash
python ops/scripts/manage_testing.py set-url https://<your-domain>/api/v1
```

To restore a backup into a freshly created database:

```bash
docker exec -i <db-container> pg_restore -U viajaya_testing -d viajaya_testing \
  --no-owner --no-privileges < backup.dump
python ops/scripts/manage_testing.py start-api   # applies any missing migrations
```

## HTTPS tunnel

The Testing APK has the URL embedded, so **use a stable domain**. A tunnel
with a random URL forces a rebuild every time it restarts.

```bash
ngrok config add-authtoken <token>          # in a separate terminal, not in an agent
ngrok http --url=https://<your-domain> 8001
```

Then set the URL and restart the API so that `CORS_ORIGINS` and `PUBLIC_API_URL`
match:

```bash
python ops/scripts/manage_testing.py set-url https://<your-domain>/api/v1
python ops/scripts/manage_testing.py start-api
```

## Build and install the Testing APK

```bash
python ops/scripts/verify_live_phone_access.py    # requires Development and Testing to pass
python ops/scripts/configure_testing_build.py     # updates TESTING_API_URL in EAS
python ops/scripts/start_testing_build.py --review-only    # what would be uploaded
python ops/scripts/start_testing_build.py --preflight-only # public URL alive
python ops/scripts/start_testing_build.py         # starts the build
python ops/scripts/verify_apk.py testing          # after downloading the APK
```

`app.config.ts` is evaluated **on the EAS server**, not on your machine: the URL comes from the
`TESTING_API_URL` variable of the `preview` environment. Skipping `configure_testing_build.py`
produces an APK that points to the previous URL. That is why `verify_apk.py` checks it.

The EAS profile is called `preview` because Expo variable environments only support
`development`, `preview` and `production`. The app identifies itself as `testing` everywhere
else: `APP_ENV`, channel, package `com.viajaya.app.testing` and scheme `viajaya-testing`.

## Verifications

| Script | What it checks |
|---|---|
| `verify_live_phone_access.py` | Simulated OTP, sign-up without email, idempotent retry, sessions, refresh rotation, revocation and isolation, in both environments. `--local` avoids the tunnel |
| `verify_local_websockets.py` | Login of an earlier driver and WebSocket in both local environments |
| `verify_testing.py` | Testing over public HTTPS: readiness, login, refresh, wrong environment header, cross token and WebSocket |
| `verify_apk.py <environment>` | ZIP integrity, embedded configuration, native identity, Maps key, own bundle and signature |
| `backup_database.py <label> [container]` | Custom-format backup before migrating |
| `activate_testing.py` | Backs up Testing and replaces only its API service |

These scripts write JSON reports to `<work>/phase02/`. None of them sends SMS or hires
external services; OTP is simulated in Development and Testing, and Production rejects it.
