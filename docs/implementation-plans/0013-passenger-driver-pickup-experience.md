# Complete pickup and ride experience

2026-09-19 · Branch `codex/ui-improvements-and-bugfixes` · Implemented and verified locally; native certification pending.

## Agreed flow

1. The passenger compares and confirms price, driver and estimated arrival.
2. The driver arrives at the origin and confirms «Ya llegué»; both see the pickup.
3. The passenger taps «Ya salí, voy al punto» and sees the notice confirmation.
   The driver sees that the passenger is on their way to the pickup point.
4. The driver confirms the passenger is on board and starts the ride.
5. On reaching the destination, the driver finishes; the passenger rates and returns home.

The departure notice does not prove that the passenger is on board nor start the ride.
If the passenger is already on board and does not use the notice, the driver can start after
confirming identity and presence. The existing public stages and the
cancellation/presence rules of plan 0007 are kept.

## Exit criteria

- [x] Persistent notice, authorized only for the owner, idempotent and valid at pickup.
- [x] HTTP response, WebSockets, outbox and snapshots share the same data.
- [x] Double tap, lost response, late read and races with start/cancellation verified.
- [x] Negotiation confirms the current offer and recovers a saved acceptance.
- [x] Each role sees stage, next action and recoverable errors; enlarged text and small screens reviewed.
- [x] Full taxi/mototaxi flow and rating verified with screens and API.
- [x] TypeScript, lint, contracts, migration and Android bundle checked.
- [ ] Walkthrough on two real phones (native certification).

Shared GPS, turn-by-turn navigation and QR reconciliation keep the production
criteria of the overall plan. They are not presented as features completed by this change.


## Contract and recovery

`POST /api/v1/rides/{ride_id}/rider-on-the-way` stores `rider_on_the_way_at`.
Only the owning passenger can create it, after arrival and for taxi/moto.
A retry returns the original notice, even if the ride has already advanced. The first
notice after start/cancel is rejected. The PostgreSQL lock serializes the
notice with start/cancellation and the outbox is stored in the same transaction.
HTTP, `ride_status` events and snapshots deliver the same data. Consumers
accept old events without the field and keep the already confirmed notices.
The additive migration `0030_rider_pickup_notice` does not invent historical notices.

Negotiation presents driver, vehicle, plate, price and ETA before assigning.
If the offer expires inside the confirmation, it is explained and no acceptance is sent.
The backend keeps the atomic acceptance and the 30-second expiry.
The arrival confirmation and the start confirmation are separate driver actions.

## Evidence of 2026-09-19

- Full backend: **721 passing, 86 skipped**, five pre-existing warnings.
  The skipped ones require optional infrastructure/flags. The specific
  PostgreSQL tests added were run separately, on a disposable database.
- Affected API/WS: **40 passing**; afterwards the pickup case was extended to
  also check snapshots for both roles: **4 passing**. Same notice/status
  after GET, retry, start, finish and rating. Outbox: one delivery per
  participant, without durable duplicates when the notice is repeated.
- PostgreSQL: **4 passing**; simultaneous double notice, notice versus start or
  cancellation and rollback if the outbox fails. Migration `0030`: upgrade, downgrade
  and upgrade on an isolated database; then applied to development without a manual restart.
- Mobile: **311 passing**, TypeScript/lint and OpenAPI/realtime contracts passed.
  Includes lost HTTP, unsaved notice, failed acceptance, late event and
  in-flight snapshots that neither delete a confirmed notice nor revert the start.
- Real screens, React Query and real hooks: two full flows (taxi/moto),
  with a lost response when accepting, notifying, finishing and rating. A double tap sends
  a single request; an error before saving allows retrying; a late arrival of the
  notice clears the error; an offer that expires inside the dialog is not accepted.
- UI: **40 combinations** of role/stage/service at 390×844 with normal text/light theme
  and 320×640 with 200 % text/dark theme, plus **16 dialogs**. Actions reachable,
  scrollable content and no horizontal overflow or JavaScript errors.
- Full Metro Android bundle: **HTTP 200, 11,885,261 bytes**. API and Metro healthy.
  It is a JavaScript build, not an installed APK or a native rendering test.
- Plan and presentation: **revision 13**. F04 keeps its pending operational criteria.

Reproducible evidence: `local-files/pickup-experience-2026-09-19/` (ignored in Git).
The viewer uses real components on React Native Web; it replaces the HTTP repository,
map, location, contacts and native navigation. It syncs both roles at the
cache boundary. API/WS and PostgreSQL are checked separately; it does not simulate an
integrated test on phones. Keyboard/TalkBack, contacts, maps,
suspend/resume and a real disconnection on two devices remain to be certified.


**Continuation, revision 14:** the user's tests detected an internal
cancellation error when rating as a driver and framing changes between
services. The manual ETA was replaced by an automatic GPS → pickup computation.
See [fix, traffic-aware routes and current evidence](../implementation-plans/0014-automatic-arrival-and-stable-route.md).
