# ViajaYa — Monorepo

A **taxi and parcel delivery** app with real-time fare negotiation between passenger and
driver. A monorepo with two independent projects that follow **Clean Architecture**:
a FastAPI backend and an Expo/React Native mobile app.

## Structure

```
ViajaYa/
├── backend/                 # FastAPI API (Python 3.11+, async, PostgreSQL). See backend/CLAUDE.md
├── mobile/                  # Expo + React Native + TypeScript app. See mobile/CLAUDE.md
├── docs/implementation-plans/   # Phased implementation plans (0001-…)
├── docs/plans/              # Production launch plan (F01-F10) and its presentation
├── docker-compose.yml       # PostgreSQL + Redis for development
└── README.md                # Product status and business context
```

**Each subproject has its own `CLAUDE.md`** with detailed architecture, commands and conventions.
**Read it before working inside `backend/` or `mobile/`.**

## Finding your way

| What are you touching? | Where to look |
|---|---|
| Server API, domain, DB, auth or WebSockets | `backend/CLAUDE.md` |
| Screens, navigation, maps, state or client WS | `mobile/CLAUDE.md` |
| Product context/status, business decisions | `README.md` + `docs/implementation-plans/` |
| Roadmap to production and status per phase | `docs/plans/production-launch-plan.md` |
| Backend ↔ mobile contract | "Backend ↔ mobile contract" section below |

## Quick start

```bash
# 1) Local infrastructure (PostgreSQL + Redis in Docker)
docker compose up -d db redis

# 2) Backend
cd backend
source .venv/bin/activate         # or: uv sync && source .venv/bin/activate
pip install -e ".[dev]"           # or: uv sync (if you use uv — recommended)
cp .env.example .env              # edit JWT_SECRET and OAuth credentials
alembic upgrade head
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000   # Swagger: /docs

# 3) Mobile (in another terminal)
cd mobile
npm install
cp .env.example .env              # API_URL = backend LAN IP, Maps/OAuth keys
npx expo start                    # dev build on emulator/device (NOT Expo Go)
```

> **Python environment:** if you use VSCode via snap, create the venv with `uv` (Pythons in `~/.local`) —
> the VSCode snap breaks the backend venv when it updates.

## Business model (summary)

- The **passenger** creates a `RideRequest` (`SEARCHING`) with origin, destination, service type
  (`taxi`/`moto`), payment method (`qr`/`cash`) and an initial fare.
- Any user can **register as a driver** from their profile with **up to one vehicle
  of each type** (`taxi`/`moto`/`truck`) and the services offered with each one: taxi,
  taxi + parcels, moto, moto + parcels or **moving** (`moving`, truck only). Each
  vehicle stays `pending` until reviewed (F04-A); in development `DRIVER_AUTO_APPROVE=true`
  approves it instantly. The account has **one active mode** (`role`): passenger or driver; when
  entering driver mode (or signing in) the user picks which vehicle to work with.
- **Drivers** whose offered services include the request's service see it and **make offers**:
  accept the passenger's fare or counter-offer (price + ETA). The offer expires after **30 s**.
- **The passenger decides**: accepting an offer = atomic direct assignment of the driver; or
  **edit** the request (pauses it in the pool without cancelling); or **raise the offer** (raises the
  fare to attract more drivers).
- The driver advances the ride: `ACCEPTED → ARRIVING → IN_PROGRESS → COMPLETED`; at the end the
  passenger rates it (score 1–5, recalculates the driver's rating).
- **Real time:** all of this is notified over **WebSocket** (driver pool, passenger ride,
  individual driver); client HTTP polling remains only as a slow fallback.

## Backend ↔ mobile contract

- The API lives under `/api/v1`. Mobile consumes it via `env.apiUrl` (config in `mobile/app.config.ts`).
- **Auth:** phone + OTP only (Google/Facebook optional, always linked to a verified
  phone); **there is no email/password access**. Managed-session JWT Bearer: the
  client stores access/refresh and refreshes on 401 (interceptor in `mobile/src/core/http/client.ts`);
  the backend validates in `backend/app/api/deps.py`.
- **WebSocket:** token via the `viajaya.auth` subprotocol + access token, never in the URL.
  Endpoints: `/ws/driver` (driver pool + active ride), `/ws/rides/{ride_id}` (offers and
  status for the passenger). Events in `backend/app/api/v1/events.py`.
- **When you change an endpoint or a schema in the backend, update the matching type/repository
  in the mobile feature** (`features/<feature>/data` and `domain/types.ts`). Keep both sides in sync.
- **CORS:** allowed origins via `CORS_ORIGINS` in the backend (`.cors_origins_list`).

## Global conventions

- **Language:** code, identifiers, comments, docstrings, tests and repository documentation in
  **English** (user preference of 2026-09-09, extended to documentation on 2026-09-24).
  App UI text and conversation with the user stay in Spanish. Verify every implementation; keep
  compatibility when renaming existing names. See the persistent preference in `AGENTS.md`.
- **Architecture:** both projects respect layer boundaries (domain without outward dependencies).
  Do not cross layers "to go faster"; follow the subproject `CLAUDE.md` rules.
- **Before committing:** run lint and type-check for the touched subproject
  (`ruff check .` / `pytest` in backend; `npx tsc --noEmit` / `npm run lint` in mobile).
- **Commits:** messages in Spanish, Conventional Commits style (`feat(scope): …`, `fix(scope): …`,
  `docs(scope): …`, `chore(scope): …`), as in the history.
- **Secrets:** never commit `.env`; use the `.env.example` files as templates.
