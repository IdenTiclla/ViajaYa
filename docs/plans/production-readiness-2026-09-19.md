# Progress review and production readiness — 2026-09-19

## Scope and conclusion

Review of the versioned code of `main`, commit `986dd79` (merge of PR #15 on
2026-09-14), the active plans and the local checks listed below. The ride and
identity core have a broad implementation; the commercial service
still requires development, provider integration and operational certification.
The [launch plan](production-launch-plan.md) is updated to revision 10.

No app/API functions, secret configurations, data or services were changed.
The pre-existing untracked directories `agent-harness-framework/`,
`done-sin-renders/` and `ui-redesign-flow/` were not included in the evaluation of the
versioned product. No commits or pushes were made in this review.

## Current evidence versus background

| Area | Evidence reviewed | Conclusion and limit |
|---|---|---|
| Environments | `backend/app/infrastructure/environment.py`, `mobile/eas.json`, `ops/compose.hosted.yml`, plan 0009 | Configuration and variants implemented. Installations and the tunnel are historical evidence; current availability and permanent hosting were not certified. |
| Phone/session/social | `backend/app/api/v1/routers/account_access.py`, `phone_verification.py`, access use cases and HTTP/WS tests | Implemented with simulated OTP in lower environments. Real Google in Development is recorded in plan 0010 on 2026-09-13; the current Testing candidate still has no documented walkthrough. |
| Production SMS | `backend/app/api/deps.py`, `backend/app/application/use_cases/request_phone_code.py` | The request requires `mock_enabled`; in production it is rejected as unavailable. There is no real adapter connected that would allow closing F02-C. |
| Recovery | `request_account_recovery.py`, `review_account_recovery.py`, `mobile/src/features/auth/application/phoneAccessController.ts`, `PhoneEntryScreen.tsx` | Logic and contract exist; the current single screen does not present the request. A visible flow and the F03-B operator tool are missing. |
| Drivers | `register_driver_vehicle.py`, `switch_account_mode.py`, migrations `0027`/`0028`, mobile `driver` feature | Sign-up, several vehicles, services and active mode implemented. Documents and administrative management remain pending. |
| Territory | `backend/app/domain/value_objects.py`, `schemas/rides.py`, `get_driver_earnings.py`, `mobile/src/features/rides/domain/money.ts` | Bolivia, currency/format and time zone remain fixed. Plan 0011 is not an implementation; its proposed migration numbers were corrected. |
| Real time | Outbox, Redis, scheduler, contracts and plan 0008 | Implementation and background of local integration. A representative rollout, monitoring with a real receiver and load certification of the candidate are missing. |
| GPS/maps/navigation | `home`/`booking`/`rides` features, HTTP routes, WS contract and `mobile/package.json` | There is device position, maps and routes. No complete driver→passenger GPS circuit, push or Navigation SDK dependency was found. |
| Payments | Backend routes and entities; `mobile/src/app/(app)/(tabs)/wallet.tsx` | `qr`/`cash` are ride options; the wallet is a placeholder. There is no evidence of the collection, commission, reconciliation and settlement circuit. |
| Parcels/moving | `delivery`/`moving` types and service compatibility per vehicle | Types supported in the ride; they do not certify recipient/package/delivery or the commercial operation of moving. |
| CI/deployment | `.github/workflows/ci.yml`, Dockerfile, operation scripts and monitoring | Versioned definitions. Merge confirmed in local Git; remote Actions status, cloud and Google Play not queried. |

The abbreviated use-case paths correspond to
`backend/app/application/use_cases/`. The review is not an exhaustive
security audit or a capacity measurement.

## Checks run on 2026-09-19

| Check | Result |
|---|---|
| Backend: `.venv/bin/pytest tests/unit tests/e2e -q` | **700 passing**, 5 warnings; 36.14 s. |
| Backend: `.venv/bin/ruff check .` | Passed. |
| Backend: `.venv/bin/python -m scripts.export_openapi --check` | Snapshot up to date. |
| Backend: `.venv/bin/python -m scripts.export_realtime_contract --check` | Contract up to date. |
| Root: `npm run openapi:check` | Mobile types up to date. |
| Mobile: `npm test` | **275 passing**, zero failures and zero skipped. |
| Mobile: `./node_modules/.bin/tsc --noEmit` | Passed. |
| Mobile: `EXPO_NO_DOTENV=1 npm run lint` | Passed. |

The backend warnings include two Starlette/AnyIO deprecations and three
helpers imported as `test_settings` that pytest counts as tests even though
they return configuration. The total of 700 is the one reported by pytest, not a
measure of functional coverage. Fixing that collection is pending maintenance.

The sandbox blocked the first backend run when initializing async SQLite and
limited the detail of the mobile processes. Both suites were repeated outside
that isolation, through automatically approved escalation, with the results
above. A diagnostic mobile trial with `--test-isolation=none` produced an
HTTP contract failure; it is not the command configured by the project. The normal
run with per-file isolation passed its 275 cases; no tests were modified
to achieve the result.

Local working logs (temporary, not needed to use the plan):

- `/tmp/viajaya-production-review-backend-tests.log`.
- `/tmp/viajaya-production-review-mobile-tests.log`.
- `/tmp/viajaya-production-review-mobile-lint.log`.

## Checks still pending

- Opt-in PostgreSQL/Redis, migrations and real races on a disposable database
  of the current candidate. Plan 0010 keeps the background of those tests; they
  are not automatically carried over to this version.
- A full remote CI run associated with the candidate commit.
- Testing API/HTTPS/WSS, deployed migrations, current APK and a walkthrough with
  two phones; social access, session, number change and recovery.
- GPS/background/push/navigation, QR/cash collection with accounting and full
  parcels, after implementing their blocks.
- Load of 500 drivers, concurrent-passenger hypotheses, latencies,
  restoration, real alerts, rollback and observed costs.
- Real SMS, production credentials, commercial terms, privacy,
  account deletion and distribution through Google Play.

## Corrections to the plan

- F01 and F02 are already merged in Git; the obsolete «unpublished» status was removed.
- F04 moves to explicit partial progress for sign-up/vehicles/modes; it is not marked closed.
- HTTPS and the initial F02-B APK are recognized as completed background; the
  update and certification of Testing remain open.
- Recovery implemented in logic is distinguished from recovery accessible on
  the screen and resolved by support.
- F03-A keeps its agreed scope and is planned after migration
  `0028`. F03-B/C remain postponed, but are necessary for launch.
- Facebook remains postponed. Moving exists partially in code; it is not
  added by inference to the agreed launch of taxi, moto and parcels.
- A milestone-based calendar is kept, without inventing a date, owners,
  an approved budget or a global progress percentage.
- The HTML presentation was also updated to revision 10 at the user's
  request. It keeps 32 slides; its full view and download include the
  current Markdown.

## External references reviewed

These queries update planning references; they do not prove accounts,
contracts or the project's availability with the providers.

- [Google Maps: price list](https://developers.google.com/maps/billing-and-pricing/pricing)
  and [Navigation SDK billing](https://developers.google.com/maps/documentation/navigation/android-sdk/pricing):
  the plan's consumption scenarios are kept; they are not a quote for the pilot.
- [Render: regions](https://render.com/docs/regions): the catalog consulted does not
  include South America; the choice remains conditioned on measuring latency in Bolivia.
  The own infrastructure bands require a detailed quote.
- [Twilio Verify](https://www.twilio.com/en-us/verify/pricing) and
  [EAS](https://expo.dev/pricing): the references of USD 0.05 per verification
  plus channel and Starter at USD 19/month plus usage are still published; no
  provider was chosen and no services were hired.
- [Google Play: personal account testing](https://support.google.com/googleplay/android-developer/answer/14151465?hl=en-GB):
  verify applicability to the owner; personal accounts created after
  2023-11-13 have a requirement of 12 testers for 14 continuous days.
- [Google Play: account deletion](https://support.google.com/googleplay/android-developer/answer/13327111?hl=en-EN):
  keep in F09 the request from the app and an accessible web path.


## Continuation: simultaneous negotiations (revision 15)

Plan [0015](../implementation-plans/0015-concurrent-negotiations.md) documents
independent sending per passenger, recovery when navigating and opening the
assigned ride from another negotiation. Verified: 334 mobile tests, 62 API/WS,
4 PostgreSQL and 17 UI cases. Android bundle updated, API/Metro healthy.
It does not modify the pending production closures or attribute the full backend
suite of earlier revisions to this run. The walkthrough on phones is missing.


## Continuation: negotiation audit (revision 16)

[Plan 0016](../implementation-plans/0016-negotiation-race-audit.md) documents
four reproduced and fixed bugs: old events that hide improvements,
responses from another ride that overwrite the active one, requests outside the first
page and an ETA tied to a pickup that changed during the computation.
Verified: 344 mobile tests, 725 backend (88 skipped, five warnings),
7 PostgreSQL and 27 UI cases. OpenAPI/types in sync, Android bundle updated,
API and Metro healthy. No database migration or commits. The walkthrough on phones is missing.
