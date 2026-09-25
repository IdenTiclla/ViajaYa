# Additional negotiation and ride-action coverage

2026-09-19 · Branch `codex/ui-improvements-and-bugfixes`.

**31 automated cases** are added to plans 0012–0016: 23 mobile,
6 HTTP/WebSocket integration and 2 PostgreSQL concurrency. The
previous cases are kept; the number of tests is not a line or branch
coverage percentage.

## Added cases

| Suite | Cases | Protected behavior |
|---|---:|---|
| `mobile/tests/tripActions.test.mjs` | 23 | Transitions, cancellation per stage, repeated taps, mutual exclusion between actions, lost response and retry, late callbacks, pickup notice, call/message errors and shared taxi/moto data |
| `backend/tests/e2e/test_offer_version_contract.py` | 4 | Taxi/moto and accept fare/counter-offer: invalid versions return 422/409, keep the current offer and produce no replacement events; an omitted or null version keeps compatibility |
| `backend/tests/e2e/test_negotiation_ws.py` | 2 | Three passengers and two drivers, six negotiations over v2, events with consecutive versions, disconnection during assignment and recovery of the remaining offers for both roles |
| `backend/tests/postgresql/test_pg_concurrency.py` | 2 | Two drivers make offers to both passengers and win different rides simultaneously, without blocking each other and withdrawing only the competing offers |

## Regression detected and fixed

Five cases initially failed: the `useTripActions` hook checked the ride and
the status of an earlier render when its callback was kept. The
screens already had controls to hide stale confirmations, but the hook
did not by itself guarantee rejecting those late calls.

It now re-checks the identity, stage and pending operation of the last
confirmed render before sending. It also avoids repeating the pickup notice if
the acknowledgement already arrived over WebSocket. The hook's 23 tests pass after
the change, including the five regressions.

The mobile tests run the original hook with state/refs kept between
renders and controlled promises. They replace React, the mutation hooks and the
native APIs: they verify the hook's decisions and effects, they do not certify the native
React lifecycle, GPS, phone or SMS. The v2 tests use real FastAPI, outbox and sockets
with temporary SQLite; races are checked separately on PostgreSQL.

## Reproduction

From `mobile/`: `npm test`, `npx tsc --noEmit`, `npm run lint`.

From `backend/`: `.venv/bin/pytest -q`, `.venv/bin/ruff check .`.
For PostgreSQL, set `VIAJAYA_TEST_DATABASE_URL` pointing exclusively to
a disposable database whose name starts with `test_`; then run
`.venv/bin/pytest -q tests/postgresql/test_pg_concurrency.py`.
The fixture recreates its schema. The verification of this revision creates a new
database and drops it when finished; it neither migrates nor cleans the development database.

## Verified results

- Mobile: **367 passing**, versus 344 before; TypeScript and lint clean.
- Backend: **731 passing**, versus 725 before; 90 skipped by opt-in
  configuration and five pre-existing warnings. Ruff clean.
- PostgreSQL: **9 passing**, versus 7 before, on a new disposable database
  dropped at the end. These tests require a run separate from the standard
  suite; the seven that already existed are not counted as new.
- UI: **27 existing cases passing again** with the bundle of the current code.
  Real screens/hooks and simulated native services; without JavaScript errors.
- Plan and presentation updated to revision 17. The OpenAPI and Android bundle
  verification of revision 16 is kept as historical; there were no changes
  to HTTP or WebSocket contracts or the PostgreSQL schema in this delivery.
- Presentation: 32 slides verified, navigation/reading/printing and a download
  identical to the plan, without overflow on desktop/mobile or JavaScript errors.

Local evidence: `local-files/test-coverage-2026-09-19/`. The walkthrough on two
phones with real GPS and network is still pending; local tests do not close F09.
