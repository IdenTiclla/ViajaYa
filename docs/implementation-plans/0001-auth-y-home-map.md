# Plan de implementación — ViajaYa (TaxiGo): Auth (email + SSO) + Vista principal con mapa

## Estado de implementación (actualizado 2026-05-29)

Backend completo **hasta la Fase 3 (incluida)**, implementado y verificado.

| Fase | Estado | Notas |
|------|--------|-------|
| 0 — Andamiaje monorepo | ✅ Hecho | `README.md`, `docker-compose.yml` (Postgres 16), `.gitignore` Python/Node |
| 1 — Dominio + infra base | ✅ Hecho | Entidad/VO/puertos, modelo SQLAlchemy, repo, migración Alembic aplicada en Postgres real |
| 2 — Auth local (JWT) | ✅ Hecho | register/login/refresh/me funcionando E2E contra Postgres |
| 3 — SSO Google + Facebook | ✅ Hecho | verificadores + `authenticate_with_oauth` + `POST /auth/oauth/{provider}` (probado con verificadores mock) |
| 4 — Andamiaje Expo + design system | ✅ Hecho | Expo SDK 56 + Router + TS; tokens, http client con refresh, componentes compartidos; bundle Android OK |
| 5 — Auth móvil (email/contraseña) | ✅ Hecho | authStore + repo + pantallas Login/Registro + gate (`Stack.Protected`); tsc/eslint/bundle OK |
| 6 — SSO móvil (Google + Facebook) | ✅ Hecho | `useSocialAuth` (expo-auth-session) conectado a botones de Login/Registro; requiere client IDs reales para runtime |
| 7 — Home (mapa + ubicación) | ✅ Hecho | feature `home` (locationService + `useCurrentLocation` con react-query), `HomeScreen` (MapView + marcador), tabs Viaje/Historial/Billetera/Perfil; tsc/eslint/export OK |
| 8 — Integración y verificación E2E | 🟡 Parcial | **integración backend en vivo verificada** (stack Postgres+API real, flujo auth E2E completo, contrato HTTP ↔ mappers/interceptor móvil, auto-refresh probado); se corrigió un bug del interceptor de refresh. Falta solo la corrida de la UI en emulador/device con claves reales (no posible headless) |

### Verificación ejecutada
Backend:
- **`pytest`: 19 tests en verde** (9 unit de casos de uso + 10 e2e de endpoints,
  sobre SQLite en memoria con OAuth simulado).
- **`ruff check`: sin hallazgos.**
- **Migración Alembic** aplicada en Postgres real; tabla `users` verificada.
- **Smoke test en vivo** contra Postgres: `register` → 201 con JWT, `/me` con
  Bearer → 200, `login` → 200, contraseña incorrecta → 401, email duplicado → 409.

Mobile (Fases 4-5):
- **`tsc --noEmit`: sin errores.**
- **`eslint .`: sin errores ni warnings.**
- **`expo config`** evalúa `app.config.ts` correctamente (ViajaYa, SDK 56, plugins).
- **`expo export --platform android`** genera el bundle JS (5.4MB con Fase 6) sin
  errores: todos los imports/rutas resuelven y empaqueta.
- **`Stack.Protected`** verificado presente en expo-router instalado (gate de auth).
- **SSO (Fase 6):** Google entrega `id_token` (`response.params.id_token`) y
  Facebook `access_token` (`response.authentication.accessToken`), coincidiendo con
  lo que esperan los verificadores del backend. Los botones quedan deshabilitados
  hasta configurar los client IDs en `.env`; el flujo en vivo se prueba en Fase 8.

Mobile (Fase 7 — Home con mapa):
- **`tsc --noEmit`: sin errores** (incluye los tipos de rutas regenerados tras el
  export, con el grupo `(tabs)` y sin la home temporal).
- **`eslint .`: sin errores ni warnings.**
- **`expo export --platform android`** genera el bundle JS (5.5MB) sin errores:
  resuelven `react-native-maps`, `expo-location`, `expo-router/js-tabs` y la feature `home`.
- **`expo config`** sigue evaluando `app.config.ts` (plugins location/secure-store/router).

> Pendiente de verificación E2E en runtime (Fase 8): correr en emulador/dispositivo
> el flujo registro → home con mapa → logout → login (local/Google/Facebook) contra
> el backend. Validado hasta compilación/empaquetado; el mapa real necesita
> `GOOGLE_MAPS_API_KEY_*` y un **development build** (react-native-maps no corre en
> Expo Go). Falta ejecutar la UI en un device real.

### Desviaciones respecto al plan original (y por qué)
- **Hash de contraseñas:** se usa la librería **`bcrypt` directamente** en lugar de
  `passlib[bcrypt]`. `passlib` 1.7.4 es incompatible con `bcrypt` 5.x (el entorno
  trae bcrypt 5.0). `BcryptPasswordHasher` trunca a 72 bytes (límite de bcrypt).
- **Dependencia añadida `requests`:** `google-auth` la requiere para su transporte
  de verificación de `id_token` (`google.auth.transport.requests`).
- **Tipo UUID del modelo:** se usa `sqlalchemy.Uuid` (agnóstico de dialecto) en vez
  de `postgresql.UUID`, para que la suite e2e corra sobre SQLite además de Postgres.
- **`AuthProvider`** es `enum.StrEnum` (Python 3.11+), serializa a su valor en la API.
- **Tabs móviles:** se importa `Tabs` de **`expo-router/js-tabs`** (en SDK 56 el
  `Tabs` del paquete raíz quedó deprecado a favor de las native tabs; los js-tabs
  mantienen el tab bar configurable con íconos/colores del diseño).
- **`useCurrentLocation`** usa **react-query** (no `useEffect`+`setState`): la regla
  `react-hooks/set-state-in-effect` (nueva en este toolchain) prohíbe setState
  alcanzable desde un efecto; react-query ya está en la app y maneja loading/error.
- **Color de tab activo / íconos de servicio:** los tokens marcan el amarillo
  (`accent`) como color de "tab activo / íconos de servicio". El amarillo sobre
  blanco no cumple contraste WCAG AA, así que el **tab activo usa el azul primario**
  (consistente con botones/enlaces) y los íconos de servicio van **oscuros sobre un
  círculo amarillo** (conserva el acento de marca con contraste correcto).
- **Entorno:** el sistema trae Python 3.14 **sin pip/ensurepip**; se bootstrapeó pip
  con `get-pip.py` dentro de un venv (`backend/.venv`). Documentado en el README.

### Cómo correr lo hecho
```bash
cd backend
python3 -m venv .venv && source .venv/bin/activate
# si no hay pip: curl -sL https://bootstrap.pypa.io/get-pip.py | python
pip install -e ".[dev]"
pytest                       # 19 passed
ruff check .                 # all checks passed
# E2E contra Postgres:
docker compose -f ../docker-compose.yml up -d db
alembic upgrade head
JWT_SECRET=dev uvicorn app.main:app --reload   # http://localhost:8000/docs
```

---

## Contexto

ViajaYa es una app de taxis y envío de encomiendas. Hoy el repo
(`/home/iden/Desktop/ViajaYa`) solo contiene `.claude/`, `.gitignore`,
`.mcp.json` (MCP de Stitch) y `docs/implementation-plans/`. No hay código.

El objetivo de esta primera entrega es arrancar el proyecto con bases sólidas
(arquitectura limpia, DRY, convenciones) y llegar funcionalmente hasta:
**registro e inicio de sesión (email/contraseña + SSO Google y Facebook) y la
primera vista principal con mapa mostrando la ubicación actual del usuario**.
La UI se guía por el diseño en Stitch (proyecto **"App de Reserva de Taxis"**,
branding **TaxiGo**, `projects/14684144038839565664`).

Pantallas Stitch que cubre esta entrega:
- **Iniciar Sesión** (`screens/f7b9ea21a68b44138b9ce183d8df4e4b`): email,
  contraseña con mostrar/ocultar, "¿Olvidaste tu contraseña?", botón
  "Iniciar Sesión", divisor "O continúa con", botón Google.
- **Crear Cuenta** (`screens/d3148365b03a4a73aeb509aa4fab7388`): nombre
  completo, correo, teléfono con prefijo país, contraseña, checkbox de
  Términos/Privacidad, botón "Crear Cuenta", social (Google/Facebook),
  enlace "¿Ya tienes una cuenta? Inicia sesión".
- **Inicio con Mapa y Ubicación** (`screens/b3f3bf79af6042efb4318c49ccbce54f`):
  top bar (menú, marca, avatar), mapa con marcador de ubicación actual
  ("Pickup point"), saludo "Good evening, {nombre}", buscador "¿A dónde?",
  tarjetas de servicio (Taxi / Moto), destinos recientes, bottom nav
  (Viaje, Historial, Billetera, Perfil).

### Decisiones confirmadas con el usuario
- **Mapas/ubicación:** `react-native-maps` + `expo-location` (development build).
- **Persistencia backend:** PostgreSQL + SQLAlchemy 2.0 async + Alembic (Docker).
- **Auth MVP:** email/contraseña con JWT (access + refresh) + **SSO Google y
  Facebook funcionales** (no placeholder).
- **Estructura:** monorepo — `backend/` y `mobile/` en la raíz, `docs/` compartido.

### Estrategia de SSO (Google + Facebook)
Patrón **token-based** (recomendado para apps móviles):
1. La app móvil ejecuta el flujo OAuth con el proveedor usando
   `expo-auth-session` y obtiene un **id_token/access_token** del proveedor.
2. La app envía ese token al backend (`POST /auth/oauth/{provider}`).
3. El backend **verifica** el token contra Google/Facebook, obtiene el perfil
   (email, nombre, provider_id), hace **find-or-create** del usuario y emite
   **nuestros propios JWT** (access+refresh). A partir de ahí el resto de la app
   usa los JWT propios igual que en el login local (DRY: misma emisión de tokens).

### Paleta / design tokens (de Stitch)
- Primario (azul): `#16308C` aprox. (botones, marca).
- Acento (amarillo): `#F5C518` aprox. (íconos de servicio, bottom nav activo).
- Superficies claras / fondo blanco, texto gris oscuro. Tipografía sans-serif.
- Se centralizan en un único archivo de theme/tokens (DRY) por plataforma.

---

## Arquitectura

### Monorepo (raíz `ViajaYa/`)
```
ViajaYa/
├── backend/                 # FastAPI (Clean Architecture)
├── mobile/                  # Expo + React Native + TypeScript
├── docs/implementation-plans/
├── docker-compose.yml       # Postgres (+ backend opcional)
└── README.md
```

### Backend — Clean Architecture por capas (estructura REAL implementada)
Dependencias apuntando siempre hacia el dominio (regla de dependencia):
```
backend/
├── app/
│   ├── domain/                       # Núcleo, sin dependencias de framework
│   │   ├── entities.py               # User + AuthProvider(StrEnum)
│   │   ├── value_objects.py          # Email, RawPassword
│   │   ├── exceptions.py             # DomainError y subclases
│   │   └── repositories.py           # Puerto UserRepository (get_by_id/email/provider/add)
│   ├── application/                  # Casos de uso (orquestación)
│   │   ├── dto.py                    # RegisterInput, LoginInput, OAuthLoginInput, SocialProfile, TokenPair
│   │   ├── interfaces.py             # Puertos PasswordHasher, TokenService, SocialIdentityVerifier
│   │   ├── token_issuer.py           # issue_token_pair() reutilizable (DRY)
│   │   └── use_cases/
│   │       ├── register_user.py
│   │       ├── authenticate_user.py
│   │       ├── authenticate_with_oauth.py   # find-or-create + emisión JWT
│   │       └── refresh_token.py
│   ├── infrastructure/               # Implementaciones concretas (adaptadores)
│   │   ├── config.py                 # Settings (GOOGLE_CLIENT_ID, FB_APP_ID/SECRET, JWT…)
│   │   ├── db/
│   │   │   ├── base.py               # DeclarativeBase
│   │   │   ├── session.py            # async engine + get_session
│   │   │   ├── models.py             # UserModel (Uuid agnóstico de dialecto)
│   │   │   └── repositories.py       # SqlAlchemyUserRepository + mappers
│   │   ├── security/
│   │   │   ├── bcrypt_hasher.py      # usa bcrypt directamente (no passlib)
│   │   │   └── jwt_service.py        # JWT access/refresh con python-jose
│   │   └── oauth/
│   │       ├── google_verifier.py    # verifica id_token con google-auth
│   │       └── facebook_verifier.py  # verifica token con Graph API (httpx)
│   ├── api/
│   │   ├── deps.py                   # wiring de casos de uso + get_current_user
│   │   ├── errors.py                 # mapeo único DomainError -> HTTP
│   │   └── v1/
│   │       ├── routers/auth.py       # register, login, refresh, me, oauth/{provider}
│   │       └── schemas/auth.py       # Pydantic req/resp
│   └── main.py                       # create_app(): CORS, routers, /health
├── migrations/                       # Alembic (0001_create_users) + env.py async
├── tests/
│   ├── fakes.py                      # repos/servicios/verifier en memoria
│   ├── conftest.py                   # app sobre SQLite + OAuth simulado
│   ├── unit/test_use_cases.py        # 9 tests
│   └── e2e/test_auth_api.py          # 10 tests
├── pyproject.toml                    # deps + ruff + pytest
├── alembic.ini
└── .env.example
```
Principios: inversión de dependencias (casos de uso dependen de puertos
`UserRepository`/`PasswordHasher`/`TokenService`/`SocialIdentityVerifier`, no de
implementaciones), DTO de API separados de entidades de dominio, casos de uso de
única responsabilidad. DRY: `config.py` y `errors.py` únicos; `issue_token_pair`
y el find-or-create se reutilizan entre login local y OAuth.
> Nota: aún no se creó `Dockerfile` (no necesario para esta entrega; el backend
> corre en venv local y Postgres vía `docker-compose`).

### Mobile — Clean Architecture feature-based
La plantilla por defecto de Expo SDK 56 ubica las **rutas en `src/app/`** (no en
una carpeta `app/` separada). El resto del código vive junto en `src/`.
`✅` = creado en la Fase 4; `⬜` = pendiente (fases 5-7).
```
mobile/
├── src/
│   ├── app/                         # Expo Router (file-based routing)
│   │   ├── _layout.tsx              ✅ Providers + bootstrap sesión + gate (Stack.Protected)
│   │   ├── index.tsx                ✅ redirect "/" según estado de sesión
│   │   ├── (auth)/_layout.tsx       ✅ Stack del grupo no autenticado
│   │   ├── (auth)/{login,register}.tsx          ✅ Fase 5 (renderizan las screens)
│   │   ├── (app)/_layout.tsx        ✅ Stack autenticado (contiene el grupo (tabs))
│   │   ├── (app)/(tabs)/_layout.tsx ✅ Tabs (expo-router/js-tabs): Viaje/Historial/Billetera/Perfil
│   │   ├── (app)/(tabs)/index.tsx   ✅ Fase 7 — Home con mapa (renderiza HomeScreen)
│   │   └── (app)/(tabs)/{history,wallet,profile}.tsx  ✅ Fase 7 — placeholders + logout (Perfil)
│   ├── core/
│   │   ├── theme/                   ✅ tokens.ts (paleta TaxiGo) + index
│   │   ├── config/env.ts            ✅ lee `extra` vía expo-constants
│   │   ├── errors/apiError.ts       ✅ mensaje legible desde error axios/API
│   │   └── http/
│   │       ├── client.ts            ✅ axios + interceptores (Bearer + refresh en 401)
│   │       └── tokenStorage.ts      ✅ SecureStore (access/refresh)
│   ├── shared/components/           ✅ Button, TextField, Divider, SocialButton, Checkbox
│   ├── features/
│   │   └── auth/
│   │       ├── domain/types.ts             ✅ User, AuthResult, puerto AuthRepository
│   │       ├── data/                       ✅ authRepository (login/register/refresh/me/oauth) + mappers
│   │       ├── application/                ✅ useLogin/useRegister + useSocialAuth + validación zod
│   │       └── presentation/               ✅ LoginScreen, RegisterScreen, BrandHeader (con SSO)
│   │   └── home/                            ✅ Fase 7
│   │       ├── data/locationService.ts         (expo-location tras un puerto) + recentDestinations.ts (mock)
│   │       ├── application/useCurrentLocation.ts (react-query: loading/granted/denied/error + retry)
│   │       └── presentation/HomeScreen.tsx      (MapView + marcador, top bar, buscador, tarjetas, recientes)
│   └── store/authStore.ts           ✅ zustand: user/status + signIn/signUp/signOut/bootstrap
├── app.config.ts                    ✅ Expo + plugins (location, secure-store) + maps keys + OAuth IDs
├── .env.example                     ✅ API_URL, claves Maps/OAuth
├── tsconfig.json                    # paths "@/*" → src/*
└── package.json
```
Principios: cada feature aislada (domain/data/application/presentation),
componentes UI compartidos (DRY), tokens de diseño centralizados, capa `data`
detrás de un puerto para mockear en tests. El SSO compartirá el mismo
`authStore`/persistencia de tokens que el login local.
> Nota Fase 4: `tokenStorage` ya está separado del `authStore` para que el
> interceptor de refresco del cliente HTTP no dependa del estado de UI.

---

## Plan de ejecución por fases (cada fase es un hito ejecutable)

### ✅ Fase 0 — Guardar el plan + andamiaje del monorepo
- **Primer paso:** copiar este plan a
  `docs/implementation-plans/0001-auth-y-home-map.md`.
- `README.md`, `docker-compose.yml` (Postgres 16 con volumen).
- `.gitignore` para Python (`__pycache__`, `.venv`, `.env`) y Node/Expo
  (`node_modules`, `.expo`, `dist`).
- **Hito:** `docker compose up -d db` levanta Postgres.

### ✅ Fase 1 — Backend: dominio + infraestructura base
1. `pyproject.toml`: fastapi, uvicorn, sqlalchemy[asyncio], asyncpg, alembic,
   pydantic-settings, passlib[bcrypt], python-jose[cryptography], google-auth,
   httpx, pytest, pytest-asyncio, ruff.
2. `config.py` (DATABASE_URL, JWT_SECRET, TTLs, CORS, GOOGLE_CLIENT_ID,
   FACEBOOK_APP_ID/SECRET) + `.env.example`.
3. Dominio: `entities/user.py` (con `auth_provider`, `provider_id`,
   `hashed_password` opcional), value objects, excepciones, puerto
   `UserRepository`.
4. Puertos de aplicación: `PasswordHasher`, `TokenService`,
   `SocialIdentityVerifier`; DTOs.
5. `db/session.py`, `db/models/user.py` (id UUID, full_name, email único, phone,
   hashed_password nullable, auth_provider, provider_id, created_at).
6. `sqlalchemy_user_repository.py` (get_by_email, get_by_provider, add).
7. Alembic init + migración de `users`.
- **Hito:** migración aplicada; tabla `users` creada.

### ✅ Fase 2 — Backend: auth local (email/contraseña + JWT)
1. `bcrypt_hasher.py`, `jwt_service.py` (access+refresh).
2. Casos de uso: `register_user`, `authenticate_user`, `refresh_token`.
3. Schemas Pydantic (RegisterRequest, LoginRequest, TokenResponse, UserResponse).
4. `deps.py` (wiring de casos de uso; `get_current_user` desde JWT).
5. `routers/auth.py`: `POST /api/v1/auth/register`, `/login`, `/refresh`,
   `GET /api/v1/auth/me`. `errors.py` + `main.py` (CORS, routers, lifespan).
6. Tests unit (mocks) + e2e (httpx/ASGITransport), incl. email duplicado.
- **Hito:** Swagger `/docs` permite registrar → login → `me` con Bearer.

### ✅ Fase 3 — Backend: SSO Google + Facebook
1. `oauth/google_verifier.py` (verifica id_token con `google-auth`) y
   `oauth/facebook_verifier.py` (valida token vía Graph API con httpx) →
   implementan `SocialIdentityVerifier`, devolviendo perfil normalizado.
2. Caso de uso `authenticate_with_oauth` (verificar → find-or-create por
   email/provider_id → emitir JWT propios, reutilizando `jwt_service`).
3. Endpoint `POST /api/v1/auth/oauth/{provider}` (provider ∈ google|facebook)
   que recibe el token del proveedor y devuelve `TokenResponse`.
4. Tests con verificadores mock (token válido → usuario nuevo y usuario existente).
- **Hito:** la API acepta tokens de Google/Facebook y emite JWT propios.

### ✅ Fase 4 — Mobile: andamiaje Expo + design system
1. Crear app Expo (TypeScript, Expo Router) en `mobile/` (SDK reciente).
2. Deps: expo-router, react-native-maps, expo-location, axios,
   @tanstack/react-query, zustand, expo-secure-store, react-hook-form, zod,
   expo-auth-session, expo-web-browser, expo-crypto.
3. `app.config.ts` (plugins maps/location con permisos iOS/Android; API_URL;
   client IDs OAuth), `tsconfig` con alias `@/*`.
4. `core/theme/tokens.ts` (paleta TaxiGo), `core/http/client.ts` (axios +
   interceptor de token + refresh automático), `core/config/env.ts`.
5. `shared/components`: `Button`, `TextField` (ícono + toggle contraseña),
   `Divider`, `SocialButton`.
- **Hito:** la app arranca en emulador mostrando una pantalla base con tokens.

### ✅ Fase 5 — Mobile: auth email/contraseña
1. `features/auth/domain` (tipos + puerto `AuthRepository`).
2. `features/auth/data/authRepository.ts` (register/login/refresh/me).
3. `store/authStore` + `AuthContext`: tokens en SecureStore; `user`, `signIn`,
   `signUp`, `signOut`; gate de navegación en `app/_layout.tsx`.
4. `LoginScreen` y `RegisterScreen` fieles al diseño Stitch (react-hook-form +
   zod, estados de carga/error). Rutas `(auth)/login.tsx`, `(auth)/register.tsx`.
- **Hito:** registro y login local funcionan E2E contra el backend.

### ✅ Fase 6 — Mobile: SSO Google + Facebook
1. Hooks `useGoogleAuth` / `useFacebookAuth` con `expo-auth-session`
   (`Google.useAuthRequest`, `Facebook.useAuthRequest`).
2. Al obtener el token del proveedor → llamar `authRepository.oauth(provider, token)`
   → guardar JWT en `authStore` (reusa el mismo flujo que el login local).
3. Conectar los botones Google/Facebook de Login y Crear Cuenta a estos hooks,
   con estados de carga/error.
- **Hito:** iniciar sesión con Google y con Facebook funciona E2E.

### ✅ Fase 7 — Mobile: Home (mapa + ubicación actual)
1. `home/data/locationService.ts` + `application/useCurrentLocation` (permiso con
   expo-location, posición actual, manejo de permiso denegado).
2. `HomeScreen`: `MapView` centrado en la ubicación actual con marcador
   "Pickup point"; top bar (menú/marca/avatar); bottom sheet con saludo dinámico,
   buscador "¿A dónde?", tarjetas Taxi/Moto y destinos recientes (mock).
3. Tabs `(app)/(tabs)`: Viaje (Home), Historial, Billetera, Perfil (placeholders
   salvo Home) con bottom nav según diseño.
- **Hito:** Home muestra el mapa centrado en la ubicación real del usuario.

### 🟡 Fase 8 — Integración y verificación E2E

**Integración backend en vivo (verificada en este entorno):**
- `docker compose up -d db` (Postgres 16, healthy) + `alembic upgrade head`
  (`0001_create_users` en head; tablas `users` + `alembic_version` confirmadas) +
  `uvicorn` sobre Postgres real (`0.0.0.0:8000`, accesible por IP LAN).
- Flujo auth E2E real con curl contra la API:
  - `GET /health` → `{"status":"ok"}`.
  - `POST /auth/register` → **201** con `{user, tokens:{access,refresh}}`.
  - `GET /auth/me` con Bearer → **200** (perfil correcto); sin token → **401**.
  - `POST /auth/login` correcto → **200**; contraseña incorrecta → **401**.
  - `POST /auth/register` email duplicado → **409**.
  - `POST /auth/refresh` con refresh válido → **200** (`{access,refresh}` plano).
  - `POST /auth/oauth/google` con token inválido → **401**.
  - Validación de email: TLD reservado (`.test`) → **422** (email-validator).
- **Contrato HTTP ↔ móvil verificado:** register/login devuelven `{user, tokens:{…}}`
  (lo que parsea `mappers.toAuthResult`) y `refresh` devuelve `{access_token,
  refresh_token}` plano (lo que lee el interceptor en `core/http/client.ts`).
- **Auto-refresh probado de extremo a extremo** (secuencia que ejecuta el
  interceptor): access token vencido en `/auth/me` → **401** → `/auth/refresh` →
  nuevo access → reintento de `/auth/me` → **200**.

**Bug corregido durante la integración** (`core/http/client.ts`): el interceptor
excluía del refresh **todas** las rutas `/auth/` (`url.includes('/auth/')`), lo que
incluía `/auth/me`. Efecto: al rehidratar la sesión (`bootstrap → me()`) con access
token vencido pero refresh válido, no se refrescaba y se cerraba sesión. Ahora la
exclusión es precisa (`NO_REFRESH_PATHS`: solo `refresh`/`login`/`register`/`oauth`),
de modo que `/auth/me` sí dispara el refresh. Verificado con el escenario de arriba.

**Pendiente (requiere device + credenciales reales, no ejecutable headless):**
- Configurar `API_URL` (IP LAN) y `GOOGLE_MAPS_API_KEY_*` en mobile; generar un
  **development build** (react-native-maps no funciona en Expo Go).
- Flujo manual en emulador/device: registrar → auto-login → Home con mapa centrado en
  la ubicación real → logout → login local → login con Google → login con Facebook.

---

## Uso del MCP de Stitch durante la ejecución
- Reusar `get_screen` sobre las 3 pantallas para extraer HTML/CSS exacto y derivar
  tokens (colores, radios, espaciados) y textos hacia `core/theme/tokens.ts`,
  garantizando fidelidad visual al diseño.

## Verificación
1. **Backend tests:** `cd backend && pytest` (unit de casos de uso + e2e de
   endpoints, incl. OAuth con verificadores mock y email duplicado).
2. **Backend manual:** `docker compose up -d db`, Alembic, `uvicorn`, probar
   `/docs`: register → login → `me`; `oauth/{provider}` con token de prueba mock.
3. **Mobile typecheck/lint:** `cd mobile && npx tsc --noEmit` + `eslint`.
4. **Mobile E2E manual:** emulador/device; flujo completo de la Fase 8, incluyendo
   SSO Google y Facebook, y refresh automático de token expirado (interceptor).

## Requisitos de credenciales (a aportar antes de la Fase 3/6)
- **Google:** OAuth Client IDs (web para backend, iOS/Android/web para Expo).
- **Facebook:** App ID y App Secret (backend) + App ID (Expo).
Mientras no estén, las fases 3 y 6 se prueban con verificadores/tokens mock.

## Fuera de alcance (siguientes entregas)
Solicitud real de viaje/encomienda, geocoding del buscador de destino, pagos,
historial real, recuperación de contraseña.
