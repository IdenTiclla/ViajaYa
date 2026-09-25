# Plan 0005 — Closing the passenger ↔ driver negotiation flow

> **Agreed scope:** full negotiation flow (without "resume ride when reopening the app").
> **Created:** 2026-06-26. Follows the conventions of `docs/implementation-plans/0002…0004`.
>
> File and component names below are historical (before the 2026-09 English renaming).

## Context

The negotiation flow today *works* end to end (create request → drivers make offers → passenger
accepts/edits/cancels), but it has **UX gaps and bugs** that break the experience and, in one case,
prevent completing a key action. The user reported three points; the exploration confirmed and
corrected them, and also discovered serious gaps that leave the passenger "blind" to live outcomes.

**What the user reported vs. the reality of the code:**

1. *"When creating the offer, the passenger gets a stock component and not the one we built, but the
   custom one does not prioritize whole numbers."* → The "custom component" we built is **`KeypadModal`** (the
   driver's own numeric keypad), and its defect is that it **accumulates in cents**
   (`mobile/src/features/driver/presentation/KeypadModal.tsx:53` → typing "15" = Bs 0.15): the
   opposite of prioritizing whole numbers. The **passenger never had a custom component**: they use a stock `TextInput`
   with `decimal-pad` (`ConfigureTripScreen.tsx:312`, `SearchingDriversScreen.tsx:183`).

2. *"The driver does not have the custom counter-offer in map mode."* → Confirmed and isolated:
   `KeypadModal` only opens from the **list** (`SolicitudesEntrantesScreen.tsx:221` →
   `RequestCard`); the map render (`SolicitudesEntrantesScreen.tsx:161-177`) **does not pass
   `onOpenKeypad`** and `MapCard` has no pencil button. The message of commit `18dd223` got
   out of sync with the code.

3. *"Animations when counter-offering."* → Sending an offer today has **zero animated feedback** (only
   the button spinner). `react-native-reanimated@4.3.1` is installed but the flow uses the legacy
   `Animated`.

**Additional serious gaps (discovered):** the passenger **has no toasts** (there is no
`usePassengerToasts`; `(app)/_layout.tsx` does not mount `<Toaster>`) and the backend **does not notify them of
the expiry** of an offer (`publish_offer_expired` only emits to the `driver_topic`). There are also
specific bugs: double `pauseForEdit` on Edit, `acceptOffer.isPending` blocking all cards,
cancel without confirmation on a ride in progress, `resetTrip()` before confirming the cancel, etc.

**Outcome:** a negotiation flow that completes without blocking either party, with live
feedback (WS + toasts) and a single, consistent, "whole-number-first" amount entry for passenger and
driver.

## Decisions (agreed with the user — do not revisit)

1. **Unify the amount entry in a reusable `FareKeypad`** (a single custom keypad) for
   passenger and driver; it replaces the stock `TextInput` of ConfigureTrip/SearchingDrivers and the
   legacy `CounterOfferModal`, and supersedes the current `KeypadModal` (whose cents logic is
   redesigned).
2. **Bolivianos by default, cents optional.** Digits are entered as whole numbers; a `.` key enables
   up to 2 decimal places. `15` → Bs 15.00; `15.5` → Bs 15.50. Prioritizes whole numbers.
3. **Scope: full negotiation flow** (all listed gaps). It does NOT include resuming the ride.
4. **New animations with `react-native-reanimated`**; the existing legacy `Animated`
   (`RadarPulse`, `SpinnerRing`, `RippleIcon`, `ConfirmationOverlay` bounce) stays intact.

## Home of the `FareKeypad`

`mobile/src/features/rides/presentation/FareKeypad.tsx` (next to `OfferLifeTimer.tsx`,
`TripRouteMap.tsx`, `RouteSummary.tsx`, which are already cross-feature, consumed by `booking` and
`driver`). The **pure whole-number-first logic** goes in `mobile/src/features/rides/domain/fareInput.ts`
(domain without React, unit-testable — it follows the "domain without IO" rule of `mobile/CLAUDE.md`).
The `Modal` + styles are reused from the current `KeypadModal.tsx` (same `colors/radius/spacing`).

**Modes (2):** `mode: 'absolute'` → display `Bs 15.50` (ConfigureTrip, driver). `mode: 'increment'`
→ display `+Bs 2.50` (SearchingDrivers). **ETA stays out of the keypad** (single responsibility): today
only the `CounterOfferModal` asked for it; the driver's main flow never sends ETA and works, so
`OfertaEnviadaScreen.submitCounter` now sends only `price`.

---

## Phase 0 — Backend: `offer_expired` to the passenger + cleanup

**Goal:** make an offer's expiry reach the `ride_topic` (passenger), not only the driver.
It unblocks the passenger's toasts and card removal (Phase 5). Independent of mobile.

- `backend/app/api/v1/events.py` — `publish_offer_expired` (114-127): add a second
  `hub.broadcast(ride_topic(offer.ride_id), …)` with `{offer_id, driver_id, ride_id, reason:"expired"}`
  so the client can locate the card and read the driver's name from its cache before deleting it.
  Style: `publish_offer_accepted` (172-215) already broadcasts to ride+driver+pool in a single fn.
- `backend/app/api/v1/routers/rides.py:268` — `asyncio.create_task(_expire_offer_after(...))` without
  a reference (GC risk). Keep it in a module `set` + a `done_callback` that discards it.
- `backend/app/application/use_cases/withdraw_offer.py:5` and `reject_offer.py` — stale docstrings that
  mention `RIDER_ACCEPTED` (a state already removed). Fix the text.
- (Optional, best-effort) periodic sweep of zombie offers: note it; `ExpireOffer`
  (`mark_expired_if_pending`) is already race-safe and the driver snapshot covers restarts.

**Validation:** new test in `tests/e2e/test_negotiation_ws.py` (pattern
`test_passenger_receives_snapshot_and_live_offer`): create ride, connect passenger WS, create offer,
force expiry (monkeypatch `OFFER_TTL≈0.1s` or call `ExpireOffer`) and assert `{type:"offer_expired"}`
on the passenger WS. `pytest tests/e2e/test_negotiation_ws.py tests/unit/test_offer_use_cases.py` +
`ruff check .`. Extend `scripts/smoke_ws.py`.

## Phase 1 — Reusable `FareKeypad` (foundation, not integrated)

**Goal:** build the component and its whole-number-first logic, ready for Phases 2 and 3.

- Create `mobile/src/features/rides/domain/fareInput.ts` — pure reducer. State
  `{intPart, fracPart, decimalActive}`. Actions `pressDigit/pressDecimal/pressDelete/reset`;
  selectors `toValue(state):number`, `toDisplay(state, mode):string`, `fromValue(n)`.
  Rules: integer capped at 6 digits (drops leading zeros); `.` enables decimals (idempotent); decimals
  capped at 2 digits; backspace pops the fraction, then disables decimals, then pops the integer.
- Create `mobile/src/features/rides/presentation/FareKeypad.tsx` — visual skeleton cloned from
  `KeypadModal.tsx:149-202` (same `styles.backdrop/sheet/grid/key`). Last row reordered to
  include the `.` key (`0 · . · ⌫ · OK`). Props: `{visible, mode:'absolute'|'increment',
  subtitle?, initialValue?, submitting, onCancel, onSubmit:(amountBs:number)=>void}`.
  `canSubmit = value>0 && !submitting`. Reset on remount via `key={…}` (existing pattern in
  `SolicitudesEntrantesScreen.tsx:231`).

**Validation:** `fareInput.test.ts` (whole numbers, cents, backspace at the decimal boundary, maxLength,
leading zeros, round `fromValue`/`toValue`). `npx tsc --noEmit && npm run lint`.

## Phase 2 — Driver: unify the keypad + wire it into the map

**Goal:** a single keypad in list, map and OfertaEnviada; enable a custom counter-offer
from the map (impossible today).

- `mobile/src/features/driver/presentation/SolicitudesEntrantesScreen.tsx` — import `FareKeypad`
  instead of `KeypadModal` (l.19); the `<KeypadModal/>` block (230-237) → `<FareKeypad mode="absolute"
  subtitle={"El pasajero ofrece Bs "+(keypadFor?.fare??0).toFixed(2)} onSubmit={submitKeypad}/>`.
  `submitKeypad` (98-110) unchanged (it already receives `price:number`).
  **Wiring into the map:** in the `<SolicitudesMapa>` render (161-177) add
  `onOpenKeypad={(r)=>setKeypadFor(r)}` (the `keypadFor` state already exists, l.66 — do not add state).
- `mobile/src/features/driver/presentation/SolicitudesMapa.tsx` — add `onOpenKeypad` to `Props`
  (31-48) and to that of `MapCard` (221-403); thread it through `renderItem` (178-196). In `MapCard`,
  next to the `+Bs` pills (328-340), add a pencil button (copy `pencilBtn` from
  `RequestCard.tsx:417-424`) that calls `onOpenKeypad`.
- `mobile/src/features/driver/presentation/OfertaEnviadaScreen.tsx` — replace `CounterOfferModal`
  (import 28; uses 151-158 and 297-303) with `<FareKeypad mode="absolute" subtitle={…}/>`.
  `submitCounter(price, etaMin)` (91-102) → `submitCounter(price:number)`; `createOffer.mutate` sends
  `{acceptAtFare:false, price}` without `etaMin`.
- **Delete** `KeypadModal.tsx` and `CounterOfferModal.tsx` once they have no references
  (`grep -r KeypadModal CounterOfferModal src/`).

**Validation:** `tsc --noEmit && npm run lint`. Manual: driver in **map** mode → pencil → keypad →
send → "Oferta enviada" banner. Verify list and map use the same overlay.

## Phase 3 — Passenger: `FareKeypad` in ConfigureTrip + SearchingDrivers

**Goal:** replace the passenger's stock `TextInput`s.

- `mobile/src/features/booking/presentation/ConfigureTripScreen.tsx` — `fareKeypadOpen` state.
  The `fareRow` with `TextInput` (310-322) → a tappable field that shows `Bs {fare||'0.00'}` and opens the
  keypad. Mount `<FareKeypad mode="absolute" subtitle="Tu oferta"
  initialValue={fare?Number.parseFloat(fare):undefined}
  onSubmit={(a)=>{setFare(String(a)); setFareKeypadOpen(false);}}/>`. The parser (176) is kept
  (now `fare` always comes clean from the keypad). When editing, the hydration effect (96-110) already
  does `setFare(String(ride.fare))` → `initialValue` reflects the loaded value.
- `mobile/src/features/booking/presentation/SearchingDriversScreen.tsx` — the `customRow` with
  `TextInput` (181-201) → a "+Bs personalizado" button that opens `<FareKeypad mode="increment"
  subtitle={currentFare!=null?\`Tu oferta actual: Bs ${currentFare.toFixed(2)}\`:undefined}
  onSubmit={(delta)=>applyIncrease(delta)}/>`.
  **Fix the `currentFare ?? 0` bug** (99): disable the pills (162-179) and the custom amount button
  until `ride.fare` loads (show spinner/disabled) — today a +Bs with `currentFare==null` sets the
  absolute fare to Bs 2.00.

**Reuse:** the `fare:string` store (`useBookingStore.ts:21`) unchanged; `useUpdateRideFare` and
`editRide` still receive a `number`. Since the system keyboard no longer appears in ConfigureTrip,
check whether `useKeyboardHeight` (247) is still needed (it can probably be removed).

**Validation:** `tsc --noEmit && npm run lint`. Manual E2E: create request (absolute) → search →
+Bs (increment, reaches drivers) → Edit (absolute with the loaded value) → save.

## Phase 4 — Functional bugs of the flow (targeted fixes)

Independent items; grouped because several touch the same files.

1. **Double `pauseForEdit`** — `ConfigureTripScreen.tsx:96-110`. Stop pausing here (the caller
   `OffersScreen.tsx:137`/`SearchingDriversScreen.tsx:77` already paused) and **only hydrate** the form from
   `useRide(rideId)` (query already cached by `usePauseForEdit.onSuccess`, `useRideMutations.ts:110`).
   Keep `didInitEdit` to hydrate only once; remove the `pauseForEdit.isError` block (330-332).
2. **`acceptOffer.isPending` blocks every card** — `OffersScreen.tsx:238` + `OfferCard`
   336/343. Compute `acceptingId = acceptOffer.isPending ? acceptOffer.variables ?? null : null` and
   pass it; `OfferCard` disables **only its Accept** when `offer.id===acceptingId`; **Reject**
   stays always enabled.
3. **`TripScreen` without confirmation** — `TripScreen.tsx:152-158`. Add a `<ConfirmDialog>` (pattern
   `SearchingDriversScreen.tsx:241-251`); the button opens the dialog instead of mutating directly.
4. **`resetTrip()` before the cancel succeeds** — `SearchingDriversScreen.tsx:86` and
   `OffersScreen.tsx:146`. Move `resetTrip()` to the `onSuccess` of `cancelRide.mutate` (together with the
   navigation); on `onError` leave the user on the screen with the error.
5. **`ConfirmationOverlay` by timeout** — `ConfirmationOverlay.tsx:39`. Advance **on tap**
   (`onPress→onDone`) with a minimum display of ~500ms and a fallback auto-dismiss at 3s; the legacy bounce is
   kept.
6. **N+1 timers** — `OfferCard` opens its own `setInterval` (`useCountdown.ts:17`) in addition to the global
   `now` (`OffersScreen.tsx:82-86`). Pass `now` as a prop to `OfferCard` and compute
   `secondsLeft=max(0,ceil((expiresAt-now)/1000))` instead of `useCountdown(offer.expiresAt)` (278).
7. **Double source of truth for "expired" (driver)** — `OfertaEnviadaScreen.tsx:74-75`. Authority =
   the WS store: `offerExpired = expired.has(rideId)`. The countdown stays display-only; if it reaches 0
   before the WS, call `markExpired(rideId)` optimistically (idempotent).
8. **`taken` state not rendered on cards** — add a `taken` prop (threaded from
   `SolicitudesEntrantesScreen.tsx:57`) and a "Otro conductor tomó el viaje" banner in `MapCard` and
   `RequestCard` (visual block of `rejectedBanner`, `RequestCard.tsx:359`).
9. **`paused` leaves the `MapCard` inert** — `SolicitudesMapa.tsx:326`. When `paused`, add a
   "Descartar" button (local dismiss) inside the existing `pausedBanner`; the same affordance in
   `RequestCard.tsx:155`.
10. **(Optional) Polling vs WS** — `useRides.ts:30`. Gate `refetchInterval` with a
    `wsConnected` flag of the socket to avoid flicker/redundant load. Non-blocking.

**Validation:** `tsc --noEmit && npm run lint`. Manual: reject one card while another is being accepted;
cancel with the network down (stays on screen); tap on the overlay; expiry in OfertaEnviada without WS.

## Phase 5 — Passenger toasts + global mounting

**Depends on:** Phase 0 (`offer_expired` to the `ride_topic`).

**Goal:** live feedback of offer outcomes to the passenger (silent today).

- Create `mobile/src/features/booking/application/usePassengerToasts.ts` — a clone of
  `useDriverToasts.ts` (zustand store, `push`/`dismiss`, max 3). Kinds:
  `'offer_received' | 'offer_expired' | 'offer_withdrawn'`.
- Create `mobile/src/features/booking/presentation/PassengerToaster.tsx` — a clone of `DriverToaster.tsx`
  (same `META` icon/color, auto-dismiss 3.5s). In Phase 6 entering/exiting are added.
- `mobile/src/app/(app)/_layout.tsx` — mount `<PassengerToaster />` next to the `<Stack>` (bare today),
  pattern `(driver)/_layout.tsx:13-17`.
- `mobile/src/features/rides/application/useNegotiationSocket.ts` (passenger branch 27-73) — fire:
  - `offer_created` (41-50): `offer_received` toast **only if it is a new offer** (guard
    `!prev.some(o=>o.id===offer.id)` — improvements replace by id and must not spam).
  - `offer_withdrawn` (51-62): if the card existed, `offer_withdrawn` toast.
  - **New** `case 'offer_expired'`: filter the offer by `offer_id` out of `['ride-offers', rideId]` and
    `offer_expired` toast (read the driver's name from the cache **before** removing it).

**Mapping:** `offer_created`(new)→`offer_received`; `offer_expired`→`offer_expired`+remove card;
`offer_withdrawn`→`offer_withdrawn`; `ride_status(accepted)`→no toast (covered by
`ConfirmationOverlay`+navigation).

**Validation:** `tsc --noEmit && npm run lint`. The extended smoke (Phase 0) covers the event; assert
the toast manually. Note: the passenger socket lives tied to `rideId` inside `OffersScreen`
(`OffersScreen.tsx:69`); toasts fire while that screen is mounted (consistent with the
driver model, where the pool socket lives in the driver layout).

## Phase 6 — Animations with Reanimated (without breaking the legacy)

**Goal:** animated feedback when counter-offering and polished transitions. Legacy `Animated` intact.

- **"Oferta enviada" overlay (driver)** — today **zero feedback**. Create
  `mobile/src/features/driver/presentation/OfferSentOverlay.tsx` (Reanimated, green check,
  auto-hide ~1.2s, `pointerEvents="none"`) analogous to `ConfirmationOverlay`. Show it in
  `SolicitudesEntrantesScreen` in the `acceptAtFare`/`quickAdd`/`submitKeypad` callbacks after
  `markOffered`.
- **Toast entering/exiting** — `DriverToaster.tsx:35-44` and `PassengerToaster.tsx` (new): each item
  in `Animated.View entering={FadeInDown.duration(250)} exiting={FadeOutUp.duration(200)}` and the
  stack with `Layout.duration(200)` for a smooth reflow.
- **"Oferta enviada" banner** — `RequestCard.tsx` (offeredBanner 257-283) and `SolicitudesMapa.tsx`
  (263-281): `Animated.View entering={SlideInDown.duration(200)}`.
- **New cards appearing** — `OffersScreen.tsx:233` and the driver's `ride_created` upsert
  (`useNegotiationSocket.ts:90-98`): `LayoutAnimation.configureNext(Presets.easeInAndEaseOut)` when
  detecting a new length (lighter than per-item Reanimated; fall back to `entering={FadeIn}` if it flickers
  with maps on Android).
- **Red countdown in the last 10s** — `OfferLifeTimer.tsx:21-30`: pulse with
  `withRepeat(withSequence(withTiming(1.06), withTiming(1)))` when `low` (keeps the
  presentational contract).
- **List↔map transition** — `SolicitudesEntrantesScreen.tsx:159`: each branch in
  `Animated.View entering={FadeIn.duration(150)} key={mode}`. Low priority.

**Risks:** do not mix legacy `Animated` and Reanimated on the same node (conflicting transforms) —
each new animation goes in its own `Animated.View`. `ReanimatedSwipeable` is already used in
`RequestCard.tsx:14`, so Reanimated is already bundled in the driver.

**Validation:** `tsc --noEmit && npm run lint`. Manual on emulator: 60fps with a long list;
visual regression of `RadarPulse`/`PulseLoader`/`SpinnerRing`.

---

## Sequence and dependencies

```
Phase 0 (backend) ──► Phase 5 (passenger toasts, needs offer_expired)
Phase 1 (FareKeypad) ──► Phase 2 (driver) ──┐
                      └─► Phase 3 (passenger) ─┤
Phase 4 (bugs) — independent (watch overlap in Offers/Searching/Configure) ─┤
Phase 6 (animations) — at the end, on top of Phases 2/3/5 already stable ───┘
```

Execution order: **0 → 1 → 2 → 3 → 4 → 5 → 6**. Phases 2 and 3 can run in parallel (different
files except `FareKeypad`). Phase 4 is best after 2/3 to avoid resolving conflicts in the same
TextInputs/overlays.

## Critical files

- `mobile/src/features/rides/presentation/FareKeypad.tsx` (new) +
  `mobile/src/features/rides/domain/fareInput.ts` (whole-number-first logic) — Phase 1
- `backend/app/api/v1/events.py` (`publish_offer_expired` to the `ride_topic`) — Phase 0
- `mobile/src/features/rides/application/useNegotiationSocket.ts` (passenger branch: new
  `offer_expired` + toasts; animated upsert) — Phases 5/6
- `mobile/src/features/booking/presentation/OffersScreen.tsx` (Phase 4 bugs + toasts + animations) —
  the center of the passenger's decision
- `mobile/src/features/driver/presentation/SolicitudesMapa.tsx` (keypad wiring into the map,
  `taken`/`paused`-dismiss banners) — Phases 2/4
- `mobile/src/features/driver/presentation/SolicitudesEntrantesScreen.tsx` (reused keypadFor,
  sending overlay) — Phases 2/6
- `mobile/src/features/booking/presentation/ConfigureTripScreen.tsx` +
  `SearchingDriversScreen.tsx` (absolute/increment keypad, double pauseForEdit) — Phases 3/4
- `mobile/src/features/booking/presentation/PassengerToaster.tsx` +
  `application/usePassengerToasts.ts` (new) — Phase 5

## Global verification (closing)

- **Backend:** `pytest` (unit + e2e, incl. the new passenger `offer_expired` one) + `ruff check .`
  + the extended `python -m scripts.smoke_ws`.
- **Mobile:** `npx tsc --noEmit` + `npm run lint` after each phase.
- **Manual E2E with the seed (`python -m scripts.seed`):** the passenger creates a request (absolute keypad) →
  the driver makes an offer from the **list** and from the **map** (pencil) → the passenger gets a new-offer toast →
  lets it expire (30s): the card disappears **with a toast** and the driver sees "expired" → accept/reject/
  edit/cancel → verify toasts on both sides, the animated "offer sent" overlay, the faded
  list↔map transition, and that `RadarPulse`/`SpinnerRing` are unchanged.
