# Negotiation race and recovery audit

2026-09-19 · Implemented and verified locally · `codex/ui-improvements-and-bugfixes`.

Continuation of plan 0015. Review and fix reproducible taxi/moto problems:

1. The expiry or rejection of an earlier offer invalidates an improvement that is still
   in flight. Exact events must remove only their `offer_id`; the ride's terminal
   events and pauses keep their barriers.
2. An HTTP response from an earlier ride can overwrite another active ride.
   The active state must keep the identity in addition to advancing status.
3. The offer screen searches only the loaded pages and declares the ride
   unavailable even though the current request is on a later page.
4. Changing the pickup during GPS/computation allows offering with an ETA from another origin.
   Mobile will send `expected_pool_version`; the backend will revalidate the version under
   the existing lock before creating/replacing the offer. Optional field for
   compatibility with older clients; no database migration.

Save reproductions before the change, add regressions, validate the HTTP
contract on both sides, real UI with hardware adapters and PostgreSQL races.
Update the plan and the presentation without certifying the walkthrough on phones.


## Reproductions and fixes

- **H16-01 · Invisible improvement:** `markExpired` and rejection with `offer_id` removed
  the whole ride attempt. They now keep the in-flight attempt and record only
  the finished ID. Four regressions cover both events with/without an earlier offer
  visible; the tests that prevent reviving the same expired offer,
  a pause, an assigned ride or an earlier HTTP response still pass.
- **H16-02 · Active ride replaced:** a response from another ride could pass the
  status comparison and replace the active one. `applyRideMutationResult` rejects
  that result when there is another non-terminal active ride. Verified for both roles.
- **H16-03 · False unavailable ride:** the viewer showed that message without querying
  the second page. `useNegotiationRide` advances pages until it finds the request
  or exhausts the pool, keeps showing recovery while reading and retries the page
  that failed without entering an automatic loop. Four hook tests and four
  UI cases cover recovery and error/retry for taxi and moto.
- **H16-04 · ETA for another pickup:** the backend accepted with HTTP 201 an offer
  whose pickup had moved while the ETA was being computed. Now the client sends
  `expected_pool_version`; the use case compares the version seen by the driver
  and the repository revalidates it under the request lock. A 409 refreshes the pool
  and requires reviewing the request; it does not offer to automatically retry the old data.
  The next submission computes the ETA for the updated coordinates and version.
  Optional compatible contract, OpenAPI and generated types in sync; no migration.

## Verification of 2026-09-19

- The previous reproductions failed: six reducer assertions, two API tests
  with `201 != 409` and two screens with «Viaje ya no disponible» without requesting another page.
- **344 mobile tests passing**, TypeScript and lint clean.
- **725 backend tests passing**, 88 skipped by opt-in configuration and five
  existing warnings. Ruff and the OpenAPI check passed.
- **7 PostgreSQL tests passing** on a new disposable database. They include two new
  cases (taxi/moto) that hold an unconfirmed edit, check that
  creation waits for the lock and then rejects the old version without creating or
  replacing offers. The database is dropped at the end; the development database is not migrated.
- **27 UI cases passing:** the 17 of simultaneous negotiation, six about events
  of earlier offers/pickup change and four of pagination/error/retry.
  Real screens and hooks; native network, GPS, map and navigation replaced by
  adapters. No JavaScript errors in the viewers.
- **API and Metro healthy**. The OpenAPI of the running server contains the new
  field; Android bundle HTTP 200, **11,899,258 bytes**, with version control.
- Plan and presentation updated to **revision 16**, with 32 slides verified:
  navigation, reading, a download identical to the plan, printing and desktop/mobile sizes
  without overflow or JavaScript errors. The walkthrough of this version
  on real phones is still pending; these tests do not certify production.

Reproducible evidence: `local-files/negotiation-bug-audit-2026-09-19/`, including
the outputs before the fix, suites, viewer and isolated PostgreSQL race.
