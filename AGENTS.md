# ViajaYa — working guide for agents

ViajaYa is a taxi and parcel monorepo with real-time fare negotiation:

- `backend/`: async FastAPI + async SQLAlchemy 2.0 + PostgreSQL, in Clean Architecture.
- `mobile/`: Expo/React Native + TypeScript, Expo Router, React Query and Zustand.
- `docs/implementation-plans/`: decisions and implementation plans. Finished plans live in `archived/`.

## Before changing code

1. Check `git status --short`. Treat out-of-scope changes as the user's work: do not revert, delete or mass-reformat them.
2. Read `CLAUDE.md` at this root and then the instructions closest to the code you will touch:
   - Backend: `backend/CLAUDE.md`.
   - Mobile: `mobile/AGENTS.md` and `mobile/CLAUDE.md`.
3. Check the relevant active plan in `docs/implementation-plans/`. In particular, `0007-cancel-search-absent-passenger.md` documents the current presence and disconnect-cancellation rules.
4. If the change crosses backend and mobile, define and update both sides of the contract in the same task.

## Global rules

- Persistent user preference (2026-09-19): operate only **Development**. **Testing (`testing`/`preview`/staging) is temporarily deprecated**; do not start it, deploy to it or prepare new deliveries there unless explicitly reactivated. Keep historical configuration and isolation; automated tests and disposable CI databases still apply. Production is a future goal.

- Persistent user preference (2026-09-09, extended 2026-09-24): write code, identifiers, new file names, comments, docstrings, tests and repository documentation in **English**. Keep app UI text and conversation with the user in Spanish; commit messages stay in Spanish. Existing contracts are renamed only with a compatible, verified migration.
- Verify every implementation before delivering it with proportional tests and checks. Record evidence and clearly separate what was verified from what is pending; do not declare a phase complete without checking its exit criteria.
- Do not include secrets or modify/commit `.env` files; use the `.env.example` files as reference.
- Do not make commits, pushes, destructive migrations or restarts of existing processes unless explicitly requested.
- To start services, first inspect what is already healthy (DB, backend, Metro and ports). Do not start an Android emulator unless explicitly asked; it uses a lot of memory.

## Architecture boundaries

### Backend

- Dependencies flow inward: `api → application → domain`. The domain does not import framework, infrastructure, API or application.
- One use case per file, with `async def execute(...)`. Dependency wiring is concentrated in `app/api/deps.py`; routers translate HTTP into use cases, without business logic.
- Pydantic schemas are not domain entities. Business errors are `DomainError` and are translated centrally in `api/errors.py`.
- Keep everything async. When changing the PostgreSQL schema, create and manually review the Alembic migration.

### Mobile

- Routes in `src/app/` only compose screens. Logic lives per feature, in `domain/`, `data/`, `application/` and `presentation/`.
- All HTTP goes through `src/core/http/client.ts`; do not use `fetch` or additional Axios instances. Runtime configuration only from `@/core/config/env`.
- WebSocket is the primary real-time channel and updates the React Query cache; polling is a slow fallback. The WS token travels in the `viajaya.auth` subprotocol, never in the URL.
- Reuse shared components and tokens from `@/core/theme`. Before using Expo APIs, check the official versioned Expo 56 documentation; the app uses a dev build, not Expo Go.

## Shared contract and business rules

- The API is under `/api/v1`; backend DTOs use `snake_case` and mobile maps them to domain types in `features/*/data`.
- When an endpoint, schema or WebSocket event changes, update the consuming schema/DTO/repository/type and its tests in the other project.
- Negotiation is decided by the passenger. Accepting an offer must stay atomic; offers expire after 30 s.
- Passenger presence has a 120 s grace period, renewable via WebSocket or `GET /rides/me/active`. Automatic cancellation may only affect `SEARCHING` rides and must keep the expected real-time events.

## Verification

Run checks proportional to the modified area before delivering:

```bash
# From backend/
.venv/bin/pytest                 # or an affected file/directory
.venv/bin/ruff check .

# From mobile/
npx tsc --noEmit
npm run lint
```

Backend unit tests use test doubles; e2e tests use async SQLite. For live WebSocket behavior, also use the smoke test or the full environment when the scope justifies it.
