# Implementation plan — ViajaYa (TaxiGo): Auth (email + SSO) + main map view

> Historical plan. Email/password access was removed on 2026-09-13 (see plan 0010); the
> architecture and names below describe the state at the time.

## Implementation status (updated 2026-05-29)

Backend complete **up to Phase 3 (included)**, implemented and verified.

| Phase | Status | Notes |
|------|--------|-------|
| 0 — Monorepo scaffolding | ✅ Done | `README.md`, `docker-compose.yml` (Postgres 16), Python/Node `.gitignore` |
| 1 — Domain + base infra | ✅ Done | Entity/VO/ports, SQLAlchemy model, repo, Alembic migration applied on real Postgres |
| 2 — Local auth (JWT) | ✅ Done | register/login/refresh/me working E2E against Postgres |
| 3 — Google + Facebook SSO | ✅ Done | verifiers + `authenticate_with_oauth` + `POST /auth/oauth/{provider}` (tested with mock verifiers) |
| 4 — Expo scaffolding + design system | ✅ Done | Expo SDK 56 + Router + TS; tokens, http client with refresh, shared components; Android bundle OK |
| 5 — Mobile auth (email/password) | ✅ Done | authStore + repo + Login/Sign-up screens + gate (`Stack.Protected`); tsc/eslint/bundle OK |
| 6 — Mobile SSO (Google + Facebook) | ✅ Done | `useSocialAuth` (expo-auth-session) wired to the Login/Sign-up buttons; requires real client IDs at runtime |
| 7 — Home (map + location) | ✅ Done | `home` feature (locationService + `useCurrentLocation` with react-query), `HomeScreen` (MapView + marker), Trip/History/Wallet/Profile tabs; tsc/eslint/export OK |
| 8 — Integration and E2E verification | 🟡 Partial | **live backend integration verified** (real Postgres+API stack, full auth E2E flow, HTTP contract ↔ mobile mappers/interceptor, auto-refresh tested); a bug in the refresh interceptor was fixed. Only the UI run on an emulator/device with real keys is missing (not possible headless) |

### Verification run
Backend:
- **`pytest`: 19 green tests** (9 use-case unit + 10 endpoint e2e,
  on in-memory SQLite with simulated OAuth).
- **`ruff check`: no findings.**
- **Alembic migration** applied on real Postgres; `users` table verified.
- **Live smoke test** against Postgres: `register` → 201 with JWT, `/me` with
  Bearer → 200, `login` → 200, wrong password → 401, duplicate email → 409.

Mobile (Phases 4-5):
- **`tsc --noEmit`: no errors.**
- **`eslint .`: no errors or warnings.**
- **`expo config`** evaluates `app.config.ts` correctly (ViajaYa, SDK 56, plugins).
- **`expo export --platform android`** generates the JS bundle (5.4MB with Phase 6) without
  errors: all imports/routes resolve and it packages.
- **`Stack.Protected`** verified present in the installed expo-router (auth gate).
- **SSO (Phase 6):** Google delivers `id_token` (`response.params.id_token`) and
  Facebook `access_token` (`response.authentication.accessToken`), matching
  what the backend verifiers expect. The buttons stay disabled
  until the client IDs are configured in `.env`; the live flow is tested in Phase 8.

Mobile (Phase 7 — Home with map):
- **`tsc --noEmit`: no errors** (includes the route types regenerated after the
  export, with the `(tabs)` group and without the temporary home).
- **`eslint .`: no errors or warnings.**
- **`expo export --platform android`** generates the JS bundle (5.5MB) without errors:
  `react-native-maps`, `expo-location`, `expo-router/js-tabs` and the `home` feature resolve.
- **`expo config`** still evaluates `app.config.ts` (location/secure-store/router plugins).

> Pending runtime E2E verification (Phase 8): run on an emulator/device
> the flow sign-up → home with map → logout → login (local/Google/Facebook) against
> the backend. Validated up to compilation/packaging; the real map needs
> `GOOGLE_MAPS_API_KEY_*` and a **development build** (react-native-maps does not run in
> Expo Go). Running the UI on a real device is missing.

### Deviations from the original plan (and why)
- **Password hashing:** the **`bcrypt` library is used directly** instead of
  `passlib[bcrypt]`. `passlib` 1.7.4 is incompatible with `bcrypt` 5.x (the environment
  ships bcrypt 5.0). `BcryptPasswordHasher` truncates to 72 bytes (bcrypt's limit).
- **Added `requests` dependency:** `google-auth` requires it for its `id_token`
  verification transport (`google.auth.transport.requests`).
- **Model UUID type:** `sqlalchemy.Uuid` (dialect-agnostic) is used instead
  of `postgresql.UUID`, so the e2e suite runs on SQLite as well as Postgres.
- **`AuthProvider`** is an `enum.StrEnum` (Python 3.11+), serialized to its value in the API.
- **Mobile tabs:** `Tabs` is imported from **`expo-router/js-tabs`** (in SDK 56 the
  root package's `Tabs` was deprecated in favor of native tabs; js-tabs
  keep the tab bar configurable with the design's icons/colors).
- **`useCurrentLocation`** uses **react-query** (not `useEffect`+`setState`): the
  `react-hooks/set-state-in-effect` rule (new in this toolchain) forbids setState
  reachable from an effect; react-query is already in the app and handles loading/error.
- **Active tab color / service icons:** the tokens mark yellow
  (`accent`) as the "active tab / service icons" color. Yellow on
  white does not meet WCAG AA contrast, so the **active tab uses the primary blue**
  (consistent with buttons/links) and the service icons are **dark on a
  yellow circle** (keeps the brand accent with correct contrast).
- **Environment:** the system ships Python 3.14 **without pip/ensurepip**; pip was bootstrapped
  with `get-pip.py` inside a venv (`backend/.venv`). Documented in the README.

### How to run what was done
```bash
cd backend
python3 -m venv .venv && source .venv/bin/activate
# if there is no pip: curl -sL https://bootstrap.pypa.io/get-pip.py | python
pip install -e ".[dev]"
pytest                       # 19 passed
ruff check .                 # all checks passed
# E2E against Postgres:
docker compose -f ../docker-compose.yml up -d db
alembic upgrade head
JWT_SECRET=dev uvicorn app.main:app --reload   # http://localhost:8000/docs
```

---

## Context

ViajaYa is a taxi and parcel delivery app. Today the repo
(`/home/iden/Desktop/ViajaYa`) only contains `.claude/`, `.gitignore`,
`.mcp.json` (Stitch MCP) and `docs/implementation-plans/`. There is no code.

The goal of this first delivery is to start the project on solid foundations
(clean architecture, DRY, conventions) and get functionally as far as:
**sign-up and sign-in (email/password + Google and Facebook SSO) and the
first main view with a map showing the user's current location**.
The UI follows the Stitch design (project **"App de Reserva de Taxis"**,
branding **TaxiGo**, `projects/14684144038839565664`).

Stitch screens covered by this delivery:
- **Iniciar Sesión** (`screens/f7b9ea21a68b44138b9ce183d8df4e4b`): email,
  password with show/hide, "¿Olvidaste tu contraseña?", "Iniciar Sesión"
  button, "O continúa con" divider, Google button.
- **Crear Cuenta** (`screens/d3148365b03a4a73aeb509aa4fab7388`): full
  name, email, phone with country prefix, password, Terms/Privacy
  checkbox, "Crear Cuenta" button, social (Google/Facebook),
  "¿Ya tienes una cuenta? Inicia sesión" link.
- **Inicio con Mapa y Ubicación** (`screens/b3f3bf79af6042efb4318c49ccbce54f`):
  top bar (menu, brand, avatar), map with the current location marker
  ("Pickup point"), "Good evening, {name}" greeting, "¿A dónde?" search,
  service cards (Taxi / Moto), recent destinations, bottom nav
  (Viaje, Historial, Billetera, Perfil).

### Decisions confirmed with the user
- **Maps/location:** `react-native-maps` + `expo-location` (development build).
- **Backend persistence:** PostgreSQL + async SQLAlchemy 2.0 + Alembic (Docker).
- **MVP auth:** email/password with JWT (access + refresh) + **working Google and
  Facebook SSO** (not a placeholder).
- **Structure:** monorepo — `backend/` and `mobile/` at the root, shared `docs/`.

### SSO strategy (Google + Facebook)
**Token-based** pattern (recommended for mobile apps):
1. The mobile app runs the OAuth flow with the provider using
   `expo-auth-session` and gets an **id_token/access_token** from the provider.
2. The app sends that token to the backend (`POST /auth/oauth/{provider}`).
3. The backend **verifies** the token against Google/Facebook, gets the profile
   (email, name, provider_id), does a **find-or-create** of the user and issues
   **our own JWTs** (access+refresh). From there the rest of the app
   uses our own JWTs just like local login (DRY: same token issuance).

### Palette / design tokens (from Stitch)
- Primary (blue): `#16308C` approx. (buttons, brand).
- Accent (yellow): `#F5C518` approx. (service icons, active bottom nav).
- Light surfaces / white background, dark gray text. Sans-serif typography.
- They are centralized in a single theme/tokens file (DRY) per platform.

---

## Architecture

### Monorepo (root `ViajaYa/`)
```
ViajaYa/
├── backend/                 # FastAPI (Clean Architecture)
├── mobile/                  # Expo + React Native + TypeScript
├── docs/implementation-plans/
├── docker-compose.yml       # Postgres (+ optional backend)
└── README.md
```

### Backend — layered Clean Architecture (ACTUAL implemented structure)
Dependencies always pointing toward the domain (dependency rule):
```
backend/
├── app/
│   ├── domain/                       # Core, without framework dependencies
│   │   ├── entities.py               # User + AuthProvider(StrEnum)
│   │   ├── value_objects.py          # Email, RawPassword
│   │   ├── exceptions.py             # DomainError and subclasses
│   │   └── repositories.py           # UserRepository port (get_by_id/email/provider/add)
│   ├── application/                  # Use cases (orchestration)
│   │   ├── dto.py                    # RegisterInput, LoginInput, OAuthLoginInput, SocialProfile, TokenPair
│   │   ├── interfaces.py             # PasswordHasher, TokenService, SocialIdentityVerifier ports
│   │   ├── token_issuer.py           # reusable issue_token_pair() (DRY)
│   │   └── use_cases/
│   │       ├── register_user.py
│   │       ├── authenticate_user.py
│   │       ├── authenticate_with_oauth.py   # find-or-create + JWT issuance
│   │       └── refresh_token.py
│   ├── infrastructure/               # Concrete implementations (adapters)
│   │   ├── config.py                 # Settings (GOOGLE_CLIENT_ID, FB_APP_ID/SECRET, JWT…)
│   │   ├── db/
│   │   │   ├── base.py               # DeclarativeBase
│   │   │   ├── session.py            # async engine + get_session
│   │   │   ├── models.py             # UserModel (dialect-agnostic Uuid)
│   │   │   └── repositories.py       # SqlAlchemyUserRepository + mappers
│   │   ├── security/
│   │   │   ├── bcrypt_hasher.py      # uses bcrypt directly (not passlib)
│   │   │   └── jwt_service.py        # access/refresh JWT with python-jose
│   │   └── oauth/
│   │       ├── google_verifier.py    # verifies id_token with google-auth
│   │       └── facebook_verifier.py  # verifies the token with the Graph API (httpx)
│   ├── api/
│   │   ├── deps.py                   # use-case wiring + get_current_user
│   │   ├── errors.py                 # single DomainError -> HTTP mapping
│   │   └── v1/
│   │       ├── routers/auth.py       # register, login, refresh, me, oauth/{provider}
│   │       └── schemas/auth.py       # Pydantic req/resp
│   └── main.py                       # create_app(): CORS, routers, /health
├── migrations/                       # Alembic (0001_create_users) + async env.py
├── tests/
│   ├── fakes.py                      # in-memory repos/services/verifier
│   ├── conftest.py                   # app on SQLite + simulated OAuth
│   ├── unit/test_use_cases.py        # 9 tests
│   └── e2e/test_auth_api.py          # 10 tests
├── pyproject.toml                    # deps + ruff + pytest
├── alembic.ini
└── .env.example
```
Principles: dependency inversion (use cases depend on the ports
`UserRepository`/`PasswordHasher`/`TokenService`/`SocialIdentityVerifier`, not on
implementations), API DTOs separate from domain entities, single-responsibility
use cases. DRY: single `config.py` and `errors.py`; `issue_token_pair`
and the find-or-create are reused between local login and OAuth.
> Note: no `Dockerfile` was created yet (not needed for this delivery; the backend
> runs in a local venv and Postgres via `docker-compose`).

### Mobile — feature-based Clean Architecture
The default Expo SDK 56 template places **routes in `src/app/`** (not in
a separate `app/` folder). The rest of the code lives together in `src/`.
`✅` = created in Phase 4; `⬜` = pending (phases 5-7).
```
mobile/
├── src/
│   ├── app/                         # Expo Router (file-based routing)
│   │   ├── _layout.tsx              ✅ Providers + session bootstrap + gate (Stack.Protected)
│   │   ├── index.tsx                ✅ "/" redirect by session state
│   │   ├── (auth)/_layout.tsx       ✅ Stack of the unauthenticated group
│   │   ├── (auth)/{login,register}.tsx          ✅ Phase 5 (render the screens)
│   │   ├── (app)/_layout.tsx        ✅ Authenticated stack (contains the (tabs) group)
│   │   ├── (app)/(tabs)/_layout.tsx ✅ Tabs (expo-router/js-tabs): Viaje/Historial/Billetera/Perfil
│   │   ├── (app)/(tabs)/index.tsx   ✅ Phase 7 — Home with map (renders HomeScreen)
│   │   └── (app)/(tabs)/{history,wallet,profile}.tsx  ✅ Phase 7 — placeholders + logout (Profile)
│   ├── core/
│   │   ├── theme/                   ✅ tokens.ts (TaxiGo palette) + index
│   │   ├── config/env.ts            ✅ reads `extra` via expo-constants
│   │   ├── errors/apiError.ts       ✅ readable message from an axios/API error
│   │   └── http/
│   │       ├── client.ts            ✅ axios + interceptors (Bearer + refresh on 401)
│   │       └── tokenStorage.ts      ✅ SecureStore (access/refresh)
│   ├── shared/components/           ✅ Button, TextField, Divider, SocialButton, Checkbox
│   ├── features/
│   │   └── auth/
│   │       ├── domain/types.ts             ✅ User, AuthResult, AuthRepository port
│   │       ├── data/                       ✅ authRepository (login/register/refresh/me/oauth) + mappers
│   │       ├── application/                ✅ useLogin/useRegister + useSocialAuth + zod validation
│   │       └── presentation/               ✅ LoginScreen, RegisterScreen, BrandHeader (with SSO)
│   │   └── home/                            ✅ Phase 7
│   │       ├── data/locationService.ts         (expo-location behind a port) + recentDestinations.ts (mock)
│   │       ├── application/useCurrentLocation.ts (react-query: loading/granted/denied/error + retry)
│   │       └── presentation/HomeScreen.tsx      (MapView + marker, top bar, search, cards, recents)
│   └── store/authStore.ts           ✅ zustand: user/status + signIn/signUp/signOut/bootstrap
├── app.config.ts                    ✅ Expo + plugins (location, secure-store) + maps keys + OAuth IDs
├── .env.example                     ✅ API_URL, Maps/OAuth keys
├── tsconfig.json                    # paths "@/*" → src/*
└── package.json
```
Principles: each feature isolated (domain/data/application/presentation),
shared UI components (DRY), centralized design tokens, the `data` layer
behind a port to mock in tests. SSO will share the same
`authStore`/token persistence as the local login.
> Phase 4 note: `tokenStorage` is already separate from `authStore` so that the
> HTTP client's refresh interceptor does not depend on UI state.

---

## Phased execution plan (each phase is an executable milestone)

### ✅ Phase 0 — Save the plan + monorepo scaffolding
- **First step:** copy this plan to
  `docs/implementation-plans/0001-auth-and-home-map.md`.
- `README.md`, `docker-compose.yml` (Postgres 16 with a volume).
- `.gitignore` for Python (`__pycache__`, `.venv`, `.env`) and Node/Expo
  (`node_modules`, `.expo`, `dist`).
- **Milestone:** `docker compose up -d db` brings up Postgres.

### ✅ Phase 1 — Backend: domain + base infrastructure
1. `pyproject.toml`: fastapi, uvicorn, sqlalchemy[asyncio], asyncpg, alembic,
   pydantic-settings, passlib[bcrypt], python-jose[cryptography], google-auth,
   httpx, pytest, pytest-asyncio, ruff.
2. `config.py` (DATABASE_URL, JWT_SECRET, TTLs, CORS, GOOGLE_CLIENT_ID,
   FACEBOOK_APP_ID/SECRET) + `.env.example`.
3. Domain: `entities/user.py` (with `auth_provider`, `provider_id`,
   optional `hashed_password`), value objects, exceptions, the
   `UserRepository` port.
4. Application ports: `PasswordHasher`, `TokenService`,
   `SocialIdentityVerifier`; DTOs.
5. `db/session.py`, `db/models/user.py` (UUID id, full_name, unique email, phone,
   nullable hashed_password, auth_provider, provider_id, created_at).
6. `sqlalchemy_user_repository.py` (get_by_email, get_by_provider, add).
7. Alembic init + `users` migration.
- **Milestone:** migration applied; `users` table created.

### ✅ Phase 2 — Backend: local auth (email/password + JWT)
1. `bcrypt_hasher.py`, `jwt_service.py` (access+refresh).
2. Use cases: `register_user`, `authenticate_user`, `refresh_token`.
3. Pydantic schemas (RegisterRequest, LoginRequest, TokenResponse, UserResponse).
4. `deps.py` (use-case wiring; `get_current_user` from the JWT).
5. `routers/auth.py`: `POST /api/v1/auth/register`, `/login`, `/refresh`,
   `GET /api/v1/auth/me`. `errors.py` + `main.py` (CORS, routers, lifespan).
6. Unit tests (mocks) + e2e (httpx/ASGITransport), incl. duplicate email.
- **Milestone:** Swagger `/docs` allows register → login → `me` with Bearer.

### ✅ Phase 3 — Backend: Google + Facebook SSO
1. `oauth/google_verifier.py` (verifies the id_token with `google-auth`) and
   `oauth/facebook_verifier.py` (validates the token via the Graph API with httpx) →
   implement `SocialIdentityVerifier`, returning a normalized profile.
2. Use case `authenticate_with_oauth` (verify → find-or-create by
   email/provider_id → issue our own JWTs, reusing `jwt_service`).
3. Endpoint `POST /api/v1/auth/oauth/{provider}` (provider ∈ google|facebook)
   that receives the provider token and returns `TokenResponse`.
4. Tests with mock verifiers (valid token → new user and existing user).
- **Milestone:** the API accepts Google/Facebook tokens and issues our own JWTs.

### ✅ Phase 4 — Mobile: Expo scaffolding + design system
1. Create the Expo app (TypeScript, Expo Router) in `mobile/` (recent SDK).
2. Deps: expo-router, react-native-maps, expo-location, axios,
   @tanstack/react-query, zustand, expo-secure-store, react-hook-form, zod,
   expo-auth-session, expo-web-browser, expo-crypto.
3. `app.config.ts` (maps/location plugins with iOS/Android permissions; API_URL;
   OAuth client IDs), `tsconfig` with the `@/*` alias.
4. `core/theme/tokens.ts` (TaxiGo palette), `core/http/client.ts` (axios +
   token interceptor + automatic refresh), `core/config/env.ts`.
5. `shared/components`: `Button`, `TextField` (icon + password toggle),
   `Divider`, `SocialButton`.
- **Milestone:** the app starts on the emulator showing a base screen with tokens.

### ✅ Phase 5 — Mobile: email/password auth
1. `features/auth/domain` (types + `AuthRepository` port).
2. `features/auth/data/authRepository.ts` (register/login/refresh/me).
3. `store/authStore` + `AuthContext`: tokens in SecureStore; `user`, `signIn`,
   `signUp`, `signOut`; navigation gate in `app/_layout.tsx`.
4. `LoginScreen` and `RegisterScreen` faithful to the Stitch design (react-hook-form +
   zod, loading/error states). Routes `(auth)/login.tsx`, `(auth)/register.tsx`.
- **Milestone:** local sign-up and login work E2E against the backend.

### ✅ Phase 6 — Mobile: Google + Facebook SSO
1. Hooks `useGoogleAuth` / `useFacebookAuth` with `expo-auth-session`
   (`Google.useAuthRequest`, `Facebook.useAuthRequest`).
2. On getting the provider token → call `authRepository.oauth(provider, token)`
   → store the JWTs in `authStore` (reuses the same flow as the local login).
3. Wire the Google/Facebook buttons of Login and Create Account to these hooks,
   with loading/error states.
- **Milestone:** signing in with Google and with Facebook works E2E.

### ✅ Phase 7 — Mobile: Home (map + current location)
1. `home/data/locationService.ts` + `application/useCurrentLocation` (permission with
   expo-location, current position, handling a denied permission).
2. `HomeScreen`: `MapView` centered on the current location with a
   "Pickup point" marker; top bar (menu/brand/avatar); bottom sheet with a dynamic greeting,
   "¿A dónde?" search, Taxi/Moto cards and recent destinations (mock).
3. Tabs `(app)/(tabs)`: Trip (Home), History, Wallet, Profile (placeholders
   except Home) with the bottom nav per the design.
- **Milestone:** Home shows the map centered on the user's real location.

### 🟡 Phase 8 — Integration and E2E verification

**Live backend integration (verified in this environment):**
- `docker compose up -d db` (Postgres 16, healthy) + `alembic upgrade head`
  (`0001_create_users` at head; `users` + `alembic_version` tables confirmed) +
  `uvicorn` on real Postgres (`0.0.0.0:8000`, reachable by LAN IP).
- Real E2E auth flow with curl against the API:
  - `GET /health` → `{"status":"ok"}`.
  - `POST /auth/register` → **201** with `{user, tokens:{access,refresh}}`.
  - `GET /auth/me` with Bearer → **200** (correct profile); without a token → **401**.
  - `POST /auth/login` correct → **200**; wrong password → **401**.
  - `POST /auth/register` duplicate email → **409**.
  - `POST /auth/refresh` with a valid refresh → **200** (flat `{access,refresh}`).
  - `POST /auth/oauth/google` with an invalid token → **401**.
  - Email validation: reserved TLD (`.test`) → **422** (email-validator).
- **HTTP ↔ mobile contract verified:** register/login return `{user, tokens:{…}}`
  (what `mappers.toAuthResult` parses) and `refresh` returns a flat `{access_token,
  refresh_token}` (what the interceptor in `core/http/client.ts` reads).
- **Auto-refresh tested end to end** (the sequence the
  interceptor runs): expired access token on `/auth/me` → **401** → `/auth/refresh` →
  new access → retry of `/auth/me` → **200**.

**Bug fixed during integration** (`core/http/client.ts`): the interceptor
excluded **all** `/auth/` routes from refresh (`url.includes('/auth/')`), which
included `/auth/me`. Effect: when rehydrating the session (`bootstrap → me()`) with an expired access
token but a valid refresh, it did not refresh and signed out. Now the
exclusion is precise (`NO_REFRESH_PATHS`: only `refresh`/`login`/`register`/`oauth`),
so `/auth/me` does trigger the refresh. Verified with the scenario above.

**Pending (requires a device + real credentials, not runnable headless):**
- Configure `API_URL` (LAN IP) and `GOOGLE_MAPS_API_KEY_*` in mobile; generate a
  **development build** (react-native-maps does not work in Expo Go).
- Manual flow on an emulator/device: sign up → auto-login → Home with the map centered on
  the real location → logout → local login → Google login → Facebook login.

---

## Using the Stitch MCP during execution
- Reuse `get_screen` on the 3 screens to extract the exact HTML/CSS and derive
  tokens (colors, radii, spacing) and texts into `core/theme/tokens.ts`,
  ensuring visual fidelity to the design.

## Verification
1. **Backend tests:** `cd backend && pytest` (use-case unit + endpoint
   e2e, incl. OAuth with mock verifiers and duplicate email).
2. **Manual backend:** `docker compose up -d db`, Alembic, `uvicorn`, test
   `/docs`: register → login → `me`; `oauth/{provider}` with a mock test token.
3. **Mobile typecheck/lint:** `cd mobile && npx tsc --noEmit` + `eslint`.
4. **Mobile manual E2E:** emulator/device; the full Phase 8 flow, including
   Google and Facebook SSO, and automatic refresh of an expired token (interceptor).

## Credential requirements (to provide before Phase 3/6)
- **Google:** OAuth Client IDs (web for the backend, iOS/Android/web for Expo).
- **Facebook:** App ID and App Secret (backend) + App ID (Expo).
While they are missing, phases 3 and 6 are tested with mock verifiers/tokens.

## Out of scope (next deliveries)
Real ride/parcel request, geocoding of the destination search, payments,
real history, password recovery.
