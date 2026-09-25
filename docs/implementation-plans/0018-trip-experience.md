# Negotiation, pickup and closing experience

2026-09-19 · Implemented and verified locally · `codex/ui-improvements-and-bugfixes`.

Improve the taxi/mototaxi flows for both participants:

- Reserve stable space for the map and keep the main actions visible.
- Give priority to the pickup/destination point and to identifying the other person.
- Separate cancellation from the main action and explain who takes the next step.
- Allow comparing offers by price or arrival without altering the passenger's decision.
- Simplify rating, keep submission visible and the comment optional.

Reuse the existing components and tokens; do not change contracts or rules for
assignment, presence, TTL, cancellation or ratings. Test taxi/moto, both
roles, light/dark themes, small screen, large text, live updates
and closing. Verifications with adapters do not certify native map/GPS.

## Delivery

- Fixed panel at 64 % of the view in offers and tracking for both roles. Its
  content scrolls inside the panel; the map keeps the remaining space
  and its locked gestures. Opening details does not move the panel or the main action.
- Driver: origin when picking up and destination when traveling inside the stage notice;
  name, call and message before the expanded detail. Compact fare/payment.
  Confirmation is still required before arriving, starting or finishing.
- Passenger: highlighted arrival notice, a clear «ya salí» confirmation and an
  expandable summary with route, fare and payment. On start the cancellation disappears; in
  earlier stages it is kept as a secondary action with confirmation.
- Offers: explicit selection between recent, lowest price and fastest arrival.
  Offers with an unknown ETA go last and ties keep their order;
  the React Query array is not modified and no driver is chosen automatically.
- Rating: submission visible from the start, disabled until stars are
  chosen. The comment is optional and opens on demand; hiding it or a failed
  submission keeps stars and draft. Skip is still available.

## Evidence of 2026-09-19

- **373 mobile tests passing**, including six new ones for comparison;
  TypeScript and lint clean. `git diff --check` without errors.
- **14 new UI cases:** five flows per service for stable detail,
  arrival/notice/start, driver rating with failure/retry, passenger pickup
  and closing and comparison/selection; four additional screens
  at 320×640, dark theme and 200 % text.
- **27 previous UI cases passing again**: simultaneous negotiation,
  navigation, withdrawal, late responses, modified pickup and pagination.
  Total: **41 cases**, without JavaScript errors. Screenshots of
  both roles, negotiation, rating and accessibility were inspected. Real screens and hooks;
  network, GPS, map, navigation and native contact adapters.
- API and Metro respond HTTP 200; updated Android bundle of **11,909,378 bytes**,
  with the new offer comparison. No services were restarted.
- Backend/contracts/database unchanged. The revision 17 evidence is kept
  as historical: 731 backend and 9 PostgreSQL tests passing.
- Plan and presentation updated to revision 18: 32 slides verified,
  navigation/reading/printing and a download identical to the plan, without overflow
  on desktop/mobile or JavaScript errors.
- Secondary actions based on `Button`, touch controls of at least 48
  points, visible focus and a selection mark in addition to color when sorting offers.

Reproducible evidence and screenshots: `local-files/trip-experience-2026-09-19/`.
The walkthrough of the current version on two real phones is still pending.
