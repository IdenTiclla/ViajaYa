# Plan 0007 — Cancel the search when the passenger disappears

> **Update 2026-07-10:** validation on a physical Android showed that 30 s
> confuses a mobile reconnection with abandonment and can cancel just as a
> counter-offer arrives. The effective grace goes back to **120 s** and `GET /rides/me/active`
> renews it: the search is only cancelled if both WebSocket and polling disappear.

> **Context:** today, when the passenger creates a request (`SEARCHING`) and **kills the app**, the
> request stays alive: during the grace window (120 s) drivers see it and can
> make offers, and when the grace expires it is only **hidden** from the pool — the `RideRequest` stays
> `SEARCHING` in the DB forever (as the docstring of `app/api/v1/presence.py:10-14` says).
> Reported symptom: drivers making offers on a request whose passenger is no longer there. This
> plan changes the grace expiry from "hide" to **really cancel**, in the backend and
> without a background location service. **Created:** 2026-07-05.

## Design decisions (agreed with the user)

- **Backend only.** We do not install `expo-task-manager` or a background location
  service: the foreground service does **not** solve "killed the app" (when the process dies, the
  service dies too), it weighs on battery/permissions and `ACCESS_BACKGROUND_LOCATION` gets
  Play Store scrutiny. The cancellation is triggered by the backend on the passenger WS
  `onclose`.
- **120 s grace + HTTP heartbeat.** We tolerate real Android reconnections; each
  successful `GET /rides/me/active` renews the window if only the WebSocket dropped.
- **No toast.** The existing mobile flow already navigates home silently on detecting
  `cancelled` (`OffersScreen.tsx:116-120`), via WS on reconnect or via the 15 s polling.

## Approach

Reuse the existing machinery. The disconnect hook, the deferred timer pattern and the
cancellation UC **already exist**; all that is missing is wiring that, when the grace expires, the
`RideRequest` is cancelled (today it is only hidden).

- Disconnect hook: `presence.on_passenger_disconnect(ride_id, session_factory)` — called in
  `app/api/v1/ws/negotiation.py:105` (the `finally` block of `passenger_ws`).
- Fire-and-forget timer pattern: `_expire_offer_after` + `_EXPIRY_TASKS` in
  `app/api/v1/routers/rides.py:86-108` — replicated exactly.
- Cancellation events: `publish_ride_status` + `publish_ride_closed` +
  `publish_offer_rejected(reason="ride_cancelled")`, already published by the manual cancel
  router in `rides.py:322-329` — reproduced the same way.

**Scope of the automatic cancellation: `SEARCHING` only.** If the request was already accepted
(`ACCEPTED`/`ARRIVING`), the auto-cancel does **not** act: there is an assigned driver on the way and the
passenger's disconnection belongs to another flow (the `TripScreen`, not this fix). This rules
out the risk of "tearing down an already assigned ride".

## Changes (all in `backend/`)

### 1. Repository — atomic `cancel_if_searching` method

`app/domain/repositories.py`: add to the `RideRequestRepository` interface

```python
async def cancel_if_searching(self, ride_id: uuid.UUID) -> RideRequest | None: ...
```

`app/infrastructure/db/repositories.py`: implement it **mirroring `accept_atomically`**
(`repositories.py:459-495`): `SELECT … FOR UPDATE` on the ride row, re-check
`status is RideStatus.SEARCHING`, move to `CANCELLED`, commit, refresh; return the updated
ride or `None` if it was no longer `SEARCHING`.

> **Why atomic:** it serializes against `accept_atomically` (both lock the same ride
> row). If an `accept` and the auto-cancel compete, the one that loses the lock sees the new state and
> aborts — a driver who just got accepted never has their ride yanked.

### 2. UC — `CancelRideOnDisconnect`

New `app/application/use_cases/cancel_ride_on_disconnect.py`. Do not reuse `CancelRide`
because (a) there is no `user` actor to authorize and (b) it must be `SEARCHING`-only:

```python
class CancelRideOnDisconnect:
    def __init__(self, rides: RideRequestRepository, offers: OfferRepository) -> None: ...

    async def execute(self, ride_id: uuid.UUID) -> CancelRideResult | None:
        updated = await self._rides.cancel_if_searching(ride_id)
        if updated is None:
            return None                      # accepted/cancelled meanwhile → do not touch
        cancelled = [o for o in await self._offers.list_by_ride(ride_id)
                     if o.status is OfferStatus.PENDING and not is_offer_expired(o)]
        await self._offers.reject_pending(ride_id)
        return CancelRideResult(ride=updated, cancelled_offers=cancelled)
```

It reuses `CancelRideResult` (`app/application/dto.py:144-149`). It does not publish events (like
every UC); the orchestrator in `presence.py` does that.

### 3. `presence.py` — 120 s grace, heartbeat + cancellation timer

`app/api/v1/presence.py`:

- Keep `PRESENCE_GRACE_SECONDS = 120.0` and renew the timer from the active endpoint.
- Add `_pending_cancels: dict[uuid.UUID, asyncio.Task[None]]` and the anti-GC set
  `_CANCEL_TASKS: set[asyncio.Task[None]] = set()` (mirror of `_EXPIRY_TASKS`).
- `on_passenger_disconnect(ride_id, session_factory)`: after setting `_last_seen`, schedules the
  deferred closing; the final transaction revalidates status and pause.
- `on_passenger_connect(ride_id, session_factory)`: in addition to `_last_seen.pop(...)`, cancel and discard the
  pending task of that ride (reconnected in time → do not cancel).
- New coroutine `_cancel_after_grace(ride_id)` (mirror of `_expire_offer_after`):
  `await asyncio.sleep(PRESENCE_GRACE_SECONDS)` → opens a new session with
  `async_session_factory()` (imported from `app.infrastructure.db.session`, lazily to avoid
  circular imports) → instantiates `SqlAlchemyRideRequestRepository`,
  `SqlAlchemyOfferRepository`, `CancelRideOnDisconnect` and runs it → if it returns a result,
  publishes the **same 3 events** as the manual cancel (`publish_ride_status` +
  `publish_ride_closed` + `publish_offer_rejected(reason="ride_cancelled")` for each live
  offer). Build the `detail` that `publish_ride_status` requires by re-fetching with
  `rides.open_ride_with_rider(ride_id)` as `passenger_ws:88` does. Best-effort: wrap in
  `try/except Exception: pass` (it is live UX, not critical); re-raise `CancelledError`.

`negotiation.py` is **not touched**: it already calls `presence.on_passenger_disconnect(ride)` in the
`finally` of `passenger_ws:105`.

### 4. Tests

`backend/tests/e2e/test_negotiation_ws.py` — extend the presence block (next to the current
`test_open_ride_*_after_disconnect`, lines 332-388):

- `test_ride_cancelled_after_grace_when_passenger_gone`: the passenger disconnects,
  `monkeypatch` `PRESENCE_GRACE_SECONDS` to ~0, assert that the ride becomes `cancelled` in the
  DB and that a connected driver receives `ride_closed` (pool) and `offer_rejected` with
  `reason:"ride_cancelled"` (personal).
- `test_ride_not_cancelled_if_passenger_reconnects_within_grace`: disconnect → reconnect
  within the grace → the ride stays `searching` and visible.
- `test_auto_cancel_does_not_touch_accepted_ride`: the offer is accepted before the
  grace expires → the auto-cancel does not touch it (ride stays `accepted`, without `ride_closed`).
- Adjust/extend `test_open_ride_hidden_after_grace_when_passenger_gone` to also assert
  the `cancelled` state in the DB (before it only checked visibility).

## Edge cases and limitations

- **Reconnect at the boundary:** the atomic `cancel_if_searching` arbitrates. If the passenger
  reconnects an instant before, `on_passenger_connect` cancels the task. If an instant
  after, the task has already run; the passenger reconnects to a `cancelled` ride and the 15 s polling
  sends them home.
- **Server restart mid-grace:** the fire-and-forget task is lost. It is the same
  limitation as `_expire_offer_after` (its mitigation is the recovery when the
  driver reconnects). For the auto-cancel it makes nothing worse than today: the ride stays hidden from the
  pool after the grace and, if the passenger never comes back, it is a silent zombie in the DB (as
  today). Not solved in this fix (out of scope).
- **Concurrent manual cancel:** if the passenger cancels by hand within the grace, the
  later auto-cancel calls `cancel_if_searching` → returns `None` (already `CANCELLED`) → does not
  publish duplicates.

## Branch and commits

- Branch: `fix/cancela-busqueda-pasajero-ausente` (from `main`).
- Commits in Spanish, Conventional Commits, without a co-author trailer (memory
  `no-coauthor-trailer`). E.g.:
  - `feat(presence): cancela la búsqueda al expirar la gracia de desconexión`
  - `test(negotiation): cubre auto-cancel por desconexión y su carrera con accept`

## Verification

1. **Tests:** `cd backend && source .venv/bin/activate && pytest tests/e2e/test_negotiation_ws.py -q` (green, including the new tests). Then `ruff check .`.
2. **Runtime on emulator** (skill `arrancar-viajaya`):
   - Start backend + passenger emulator + driver emulator.
   - The passenger creates a ride (`SEARCHING`); the driver sees it in the pool and makes an offer.
   - **Kill the passenger app** (swipe-up / force-stop).
   - After ~120 s: the driver must receive `ride_closed` live (the card disappears) and, if they
     made an offer, `offer_rejected reason:"ride_cancelled"`; `GET /api/v1/rides/open` no longer
     lists it; the ride in the DB is `cancelled`.
   - **Reconnection control:** repeat but reopen the passenger app before 120 s → the
     request stays `searching` and the driver still sees it (the task was cancelled).
3. **Race:** make and accept the offer at ~29 s into the grace → the auto-cancel must not
   tear down the accepted ride.
