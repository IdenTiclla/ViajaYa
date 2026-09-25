# Simultaneous negotiations

2026-09-19 · Implemented and verified locally · `codex/ui-improvements-and-bugfixes`.

The driver must be able to make offers on several requests and the passenger to compare several
drivers on their request. Each offer expires after 30 seconds. The first
valid acceptance assigns a single ride to the driver, withdraws their other offers and
keeps the negotiations of the other drivers with the other passengers.
The one-active-ride-per-participant rule is not extended.

## Changes and exit criteria

- Independent sending/ETA per request, without a modal that blocks the rest of the pool.
  A double tap on the same passenger does not duplicate the submission; out-of-order
  responses keep their callbacks and errors. Retrying one does not resend the others.
- Counter of waiting offers, direct access to each offer and an explicit action
  to keep browsing requests without withdrawing the proposal.
- An acceptance in any negotiation opens the assigned ride, even while
  another offer is being viewed. The backend keeps the existing atomic assignment.
- Verify API/WS with several passengers and drivers, reconnection and withdrawal of
  the winner's offers. Verify real concurrency on disposable PostgreSQL.
- Test real cards/screens with overlapping submissions, independent errors,
  going back to the pool and acceptance of another negotiation; TypeScript, lint and bundle.
- Update the plan and the presentation with evidence, separating local tests
  from the pending validation on physical phones.


## Result and evidence

- The backend already supported multiple offers; the contract and its atomic
  assignment are kept. There were no schema or backend logic changes for this delivery.
- The ETA/sending modal is removed. Each card has its pending state and
  errors are identified per passenger, with independent retry. The state of
  the mutations survives switching between list and detail. The sending
  confirmation is now a compact notice that neither darkens nor captures taps.
- The list shows how many offers are still waiting and allows opening «Ver oferta»
  directly. «Seguir viendo solicitudes» keeps the proposal. The acceptance
  of another negotiation immediately opens the ride that was assigned.
- **334 mobile tests passing**, including five new cases: responses in
  reverse order, double tap per request, independent error/retry, separate
  errors and a pending submission from an earlier screen. TypeScript and lint clean.
- **62 API/WS tests passing**. The two new cases (taxi/moto) connect three
  passengers and two drivers, create six offers, recover a driver's three offers
  on reconnect and verify selective withdrawal, rejection of a late
  acceptance and blocking of the busy driver's offers. Another passenger can still
  accept the second driver. Three pre-existing warnings in this suite.
- **4 PostgreSQL tests passing** on a new disposable database: two passengers
  accepting the same driver, two drivers for the same passenger, two simultaneous
  offers for the same pair and an index that prevents duplicating active rides.
  The development database is not modified; the temporary database is dropped at the end.
- **17 UI cases passing**: three overlapping submissions and inverted responses;
  going back without withdrawing; acceptance of another negotiation; isolated retry/withdrawal;
  navigation during a submission; driver comparison by the passenger and the
  map carousel. Repeated for taxi/moto, adding a 320×640 screen, dark
  theme and 200 % text. No JavaScript errors or horizontal overflow.
- **Android:** bundle HTTP 200, **11,896,851 bytes**, with the new
  concurrency code. API and Metro healthy; no processes restarted and no emulator started.
- **Plan/presentation:** revision 15, 32 slides. Navigation, reading, a download
  identical to the plan, printing and desktop/mobile sizes passed; no JavaScript
  errors or overflow.

Local evidence: `local-files/concurrent-negotiations-2026-09-19/`.
The viewer uses real screens, cards, hooks, React Query and state; it replaces
GPS, HTTP, navigation, the native map and the swipe gesture. API/WS and PostgreSQL have
independent tests. Validating this version on two real phones is still missing,
including mobile network, GPS and native map rendering. No production launch is declared.
