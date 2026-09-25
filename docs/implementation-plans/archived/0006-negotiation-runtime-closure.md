# Plan 0006 — Closing the negotiation flow: runtime bugs and UX polish

> **Context:** plan 0005 was fully implemented (unified FareKeypad, toasts on
> both sides, `offer_expired` to the passenger, Reanimated animations) with green `tsc`/`lint`/`pytest`,
> but **not tested at runtime**. This closing exploration found bugs that only
> show up at runtime (component internal state, expiry races, outcomes
> arriving over WS). **Created:** 2026-07-01.
>
> File and component names below are historical (before the 2026-09 English renaming).

## Bugs found and their fix

### 1. `FareKeypad` does not resync when reopened (all screens)

The keypad state is initialized **only on mount** (`useState(() => fromValue(initialValue))`,
`FareKeypad.tsx:50`) and the component lives mounted with `visible=false`. Consequences:

- **ConfigureTrip (Edit request):** form hydration (`setFare(String(ride.fare))`)
  runs after mount → opening the keypad shows the amount it mounted with (old if the
  passenger raised the offer with `+Bs` during the search), not the current one.
- **All:** if the user types and **cancels**, on reopening they see the discarded input instead of
  starting clean / with the current value.

**Fix (central):** in `FareKeypad`, reset the state from `initialValue` every time `visible`
goes from false → true (`wasVisible` ref + effect). With this the `key={keypadFor?.id ?? 'none'}` of
`SolicitudesEntrantesScreen` is unnecessary (removed: a single mechanism).

### 2. Passenger stuck if the last offer expires during the confirmation overlay

In `OffersScreen`, if the accepted offer was the only visible one and its `expiresAt` passes while
`ConfirmationOverlay` is shown (`confirming=true`), rendering falls into
`visibleOffers.length === 0` → mounts `SearchingDriversScreen`, **unmounts the overlay** and
`handleConfirmed` never runs; the fallback effect requires `!confirming` → the passenger stays on
"Buscando ofertas…" with the ride already assigned.

**Fix:** do not switch to the search screen while `confirming`
(`visibleOffers.length === 0 && !confirming`).

### 3. Ride cancelled "from outside" = infinite search

If `ride.status` becomes `cancelled` via WS/polling without this screen initiating it (cancelled on
another device/session), `assigned=false` and `OffersScreen` shows `SearchingDriversScreen`
forever, and keeps querying `/offers` of a dead ride.

**Fix:** effect in `OffersScreen`: on detecting `cancelled` (with no local mutation in flight and no
`confirming`), `resetTrip()` + go back home. Also `useRideOffers` is disabled as well
when the ride is cancelled.

### 4. Confusing toasts when the driver improves their offer

`publish_offer_superseded` emits `offer_withdrawn` (the old one) + `offer_created` (the new one). The
passenger sees **two toasts**: "Juan retiró su oferta" followed by "Nueva oferta – Juan": noise and
also false (they did not withdraw it, they improved it).

**Fix:** the backend adds `reason: "superseded"` to the improvement's `OFFER_WITHDRAWN`
(`events.py`); the client removes the card **without a toast** when `reason === 'superseded'` (the
following `offer_created` already announces the new amount). E2e test: assert the `reason` in the
supersede event (`test_negotiation_ws.py`).

### 5. Dead code: `useKeyboardHeight` in ConfigureTrip

There is no `TextInput` left (the amount is entered with the keypad): the system keyboard never
appears and the hook was dead. It is removed (planned as a review item in 0005/Phase 3).

## Verification

- **Static:** `npx tsc --noEmit` + `npm run lint` (mobile); `ruff check .` + `pytest` (backend,
  includes the new `superseded` assert).
- **Runtime (real backend):** `docker compose up -d db` → `alembic upgrade head` → `uvicorn` →
  `python -m scripts.seed` → `python -m scripts.smoke_ws` (real passenger and driver over
  HTTP+WS: request → visible in pool → cleanup).
- **Manual (pending on emulator):** E2E negotiation flow with two seed accounts; the
  points of this plan cover precisely what static verification cannot see.

## Critical files

- `mobile/src/features/rides/presentation/FareKeypad.tsx` — resync on open (bug 1)
- `mobile/src/features/booking/presentation/OffersScreen.tsx` — bugs 2 and 3
- `mobile/src/features/rides/application/useNegotiationSocket.ts` — `superseded` without toast (bug 4)
- `backend/app/api/v1/events.py` + `tests/e2e/test_negotiation_ws.py` — supersede `reason`
- `mobile/src/features/booking/presentation/ConfigureTripScreen.tsx` — cleanup (bug 5)
- `mobile/src/features/driver/presentation/SolicitudesEntrantesScreen.tsx` — remove the keypad `key`
