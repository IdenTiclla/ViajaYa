# ViajaYa

**Current policy (2026-09-19):** we only use **Development**. **Testing (`testing`/`preview`/staging) is temporarily deprecated**: do not start, deploy or produce deliveries for that environment. Production remains a future goal. Previous configurations are kept for reference; automated tests and disposable CI databases still apply.

A taxi and parcel delivery app. Monorepo with a FastAPI backend and a React Native
mobile app (Expo + TypeScript), following clean architecture.

## Structure

```
ViajaYa/
├── backend/                 # FastAPI API (Clean Architecture)
├── mobile/                  # Expo + React Native + TypeScript app
├── docs/implementation-plans/
└── docker-compose.yml       # PostgreSQL + Redis for development
```

## Requirements

- Python 3.11+ and Docker (backend)
- Node 22.13+ (mobile; Expo CLI runs from the local dependencies)

## Backend setup

```bash
# 1. Start PostgreSQL and Redis
docker compose up -d db redis

# 2. Create the environment and install dependencies
cd backend
python3 -m venv .venv && source .venv/bin/activate
pip install -e ".[dev]"

# 3. Configure environment variables
cp .env.example .env   # edit JWT_SECRET and OAuth credentials

# 4. Apply migrations
alembic upgrade head

# 5. Start the API
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
# Swagger: http://localhost:8000/docs
```

## Backend tests

```bash
cd backend && pytest
```

Continuous integration runs in parallel the fast backend suite, the
transactional tests against PostgreSQL 16 and the mobile TypeScript and
ESLint checks. Local PostgreSQL certification requires a disposable database
explicitly marked as test through `VIAJAYA_TEST_DATABASE_URL`.

## Status

- [x] Phone/simulated OTP access, revocable sessions and social linking.
  Google tested in Development; real SMS pending for the future launch.
  Facebook remains postponed. There is no email/password access.
- [x] Taxi, moto and parcel requests with routes on the map.
- [x] Driver pool and offer negotiation with 30 s expiry.
- [x] Ride lifecycle, history, earnings and ratings.
- [x] Live updates over WebSocket and cancellation on absence.
- [x] CI with real PostgreSQL, OpenAPI/WS contracts and generated mobile types.
- [x] Durable real time and multi-worker support via outbox, Redis and
  shared presence (operational activation still behind flags).
- [x] Registration from Profile, several vehicles per driver and mode/vehicle switching.
  Documents, administrative review, suspension and operations still pending.

**Production launch — review 2026-09-19:** F01 completed locally; F02 in
progress and F04 partially implemented. F03 is planned; GPS tracking and Android navigation have a local delivery (0022);
navigation certification on phones, payments/commissions, full parcels,
hosted certification and Google Play remain pending. Selecting QR does not process a
payment yet. See the [current plan](docs/plans/production-launch-plan.md) and the
[review evidence](docs/plans/production-readiness-2026-09-19.md).

The current rules and pending hardening live in
`docs/implementation-plans/0007-cancel-search-absent-passenger.md` and
`docs/implementation-plans/0008-architecture-hardening.md`. Finished plans
are kept in `docs/implementation-plans/archived/`.

## Mobile setup

```bash
cd mobile
npm install
cp .env.example .env    # API_URL (backend LAN IP), Maps/OAuth keys
npx expo start          # then open the dev build on an emulator or device
# Quality:
npx tsc --noEmit && npm run lint
```

**Navigation and tracking (2026-09-19):** private GPS for the passenger, Android navigation to pickup/destination and Waze implemented in Development. Debug APK built; 746 backend and 429 mobile tests passing. Certifying the trip with two phones, real GPS and Navigation SDK authorization is still pending. See [delivery 0022](docs/implementation-plans/0022-driver-navigation-and-live-tracking.md).
