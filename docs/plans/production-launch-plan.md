# ViajaYa production launch plan

Initial date: September 9, 2026. **Update: September 24, 2026 · Revision 24.** Reviewed base: `main`, commit `a5246b7` (merge of PR #19, 2026-09-24).

**Current policy (2026-09-19):** we only use **Development**. **Testing (`testing`/`preview`/staging) is temporarily deprecated**: do not start, deploy or produce deliveries for that environment. Production remains a future goal. Previous configurations are kept for reference; automated tests and disposable CI databases still apply.

**Situation:** the ride and access core is implemented; there is not yet enough evidence to open to the public. F01 is completed locally, F02 is still in progress and F04 has an early partial delivery. F03 is planned but not implemented. F05 and F06 add a local delivery of GPS tracking, integrated Android navigation and Waze; phone testing remains pending. F07–F10 remain pending.

The status is based on code, history and [the evidence of this review](production-readiness-2026-09-19.md). The APK installation, Google in Development and Testing HTTPS correspond to historical verifications of 2026-09-09 to 13; this review does not check that those services are still running or that the phones have the current code. The last documented Testing APK precedes the latest fixes and social access.

**Local delivery after the base:** the branch `codex/ui-improvements-and-bugfixes` adds improvements to access/registration and to the taxi and mototaxi flow, recorded in `e10e6ae`. Revision 14 fixes the error when closing the driver's rating, replaces the manual ETA with a GPS → pickup computation, selects the fastest alternative with traffic and stabilizes/locks the map when switching service. It keeps the coordination arrival → «ya salí» → start → closing. Revision 15 allows sending several offers without blocking the rest of the pool, keeps submissions when navigating and opens the assigned ride even if another negotiation was being viewed. Revision 16 fixes improvements hidden by old events, responses from other rides, page recovery and offers on a modified pickup; see [audit 0016](../implementation-plans/0016-negotiation-race-audit.md). Revision 17 adds 31 automated cases and fixes the check of late confirmations; see [coverage and evidence 0017](../implementation-plans/0017-trip-test-coverage.md). See [simultaneous negotiations and evidence](../implementation-plans/0015-concurrent-negotiations.md). Earlier evidence and limits: [automatic ETA and stable map](../implementation-plans/0014-automatic-arrival-and-stable-route.md) and [pickup experience](../implementation-plans/0013-passenger-driver-pickup-experience.md).

**Ride experience (revision 18):** map with stable space during negotiation and tracking, comparing offers by price/arrival, pickup and contact more visible for the driver, secondary cancellation and a short rating with an optional expandable comment. See [experience and validation 0018](../implementation-plans/0018-trip-experience.md).

**Shared components (revision 19):** buttons with a consistent hierarchy, fields with help and counter, mobile-adapted confirmations, loading/error states and reusable avatars. Applied to offers, tracking, profile and rating; see [delivery and validation 0019](../implementation-plans/0019-shared-components.md).

**Maps (revision 20):** flat buildings, locked driver waiting map and a radar tied to their projected position; configure without the top A/B blocks and closer routes with compact margins and measured panels. See [delivery and validation 0020](../implementation-plans/0020-map-framing-and-radar.md).

**Arrival and map space (revision 21):** fixed the offer with a nearby pickup, which discarded a valid Google response and showed a false connection error. Configure uses controls over the map; search measures its space and brings the route closer. Every map disables interiors and tilt and hides building/relief geometry, also in the light theme. See [evidence and native verification limit 0021](../implementation-plans/0021-nearby-arrival-and-clear-maps.md).

**Tracking and navigation (revision 22):** the previous work was stored in `e10e6ae`. Private per-ride GPS is added with snapshot/reconnection, a stale signal and a cutoff at closing; an Android service to share while using Waze; Google Navigation to the pickup and the destination, without automatically advancing the ride. Merged into `main` with PR #16 on 2026-09-22. See [implementation, evidence and pending items 0022](../implementation-plans/0022-driver-navigation-and-live-tracking.md).

**Integration and verification (revision 24):** all the work of revisions 11–22 is now in `main` (PR #16, 2026-09-22). PR #17 adds the visual identity (logo, native splash and launch screen with the slogan) and fixes the A/B tooltips in configure. PR #18 moves code, comments and tests to English and makes the A/B route pins exact: they have the selection pin's shape and the stem tip is the coordinate; checked with a debug crosshair on a physical phone (passenger search and the driver's requests map). PR #19 moves the repository documentation to English. **The remote CI of `main` (`a5246b7`) passed all 5 jobs** (fast backend, PostgreSQL integration, runtime image smoke, Windows environment contracts and mobile types/tests/lint). Local run on 2026-09-24: **746 backend tests passing** (91 opt-in skipped, five existing warnings) and **454 mobile tests passing**. Phase statuses do not change: the two-phone certification of GPS/navigation, real SMS, the panel, payments and parcels are still pending.

### What we have and what prevents launching

| Area | Verifiable progress | Pending to operate |
|---|---|---|
| Rides | Simultaneous negotiations, atomic assignment, arrival, «ya salí» notice, start, closing, history and ratings | Incidents, verified pickup and operational support |
| Access | Phone/simulated OTP, revocable sessions, social linking; Google tested in Development | Real SMS, phone walkthrough of the current candidate and recovery accessible to the user and the operator |
| Drivers | Registration from Profile, up to one vehicle per type, services and mode/vehicle switching | Private documents, administrative review, suspension, expirations and per-zone eligibility |
| Real time and maps | WebSockets, outbox, Redis, scheduler, maps, routes, driver GPS to the passenger and Android navigation (local) | Operational rollout, two-phone certification of GPS/navigation, push |
| Money and parcels | QR/cash selection and the `delivery` service type | Verifiable collection, commissions, settlements, recipient, package and delivery confirmation |
| Deployment | Configuration of three environments, Docker, CI and Android variants | Certified hosting, restoration, target load, privacy and Google Play |

**No global percentage is computed:** the ten phases have different sizes and several contain partial progress. A phase closed locally is not equivalent to 10 % of the product nor does it certify production.

The [HTML presentation](presentacion-salida-produccion.html) was synchronized with revision 24: it summarizes the ten phases, the evidence and the next deliveries. Its «Plan completo» view and its download contain this full document (in English; the slides stay in Spanish).

## 1. Goal and starting decisions

Launch publicly on **Android, in Bolivia, with taxi, moto and parcels**, prepared to add other countries. Include **QR payments at the end and cash**, a per-service commission and an **admin panel with feature flags**.

The target capacity will be **500 connected drivers and 5,000 daily services**. It is a goal we must prove with tests; it does not require hiring all that capacity from day one.

The project already has negotiation, atomic assignment, ride lifecycle, history, ratings, WebSockets, outbox, Redis and a base of automated tests. The main pending items are in account security, commercial operations, GPS tracking, payments, parcels and deployment.

Initial decisions:

- Enable coverage by cities and zones from the panel. Publishing in Bolivia will not automatically enable the whole territory.
- Keep the FastAPI monolith and the current app.
- Operate only **Development** while this decision holds. **Testing is temporarily deprecated**; it is not a dependency to validate the current work. Production will be enabled in a future approved delivery.
- Unify sign-in and sign-up into **Continuar con teléfono**, without a password for the new flow: **real SMS OTP in production** and **simulated OTP with autofill in development**. Google and Facebook will be optional alternatives, also subject to the phone verification flow of the corresponding environment.
- Offer **turn-by-turn navigation inside ViajaYa with the Google Navigation SDK**, to the pickup and then to the destination. Waze will be a voluntary external option; it does not replace the integrated navigation requirement.
- Add configurable country, currency, time zone and providers. Bolivia starts with `BO`, `BOB` and `America/La_Paz`.
- Leave iOS, international rides and currency conversion for later phases.
- Keep the agreed launch scope: taxi, moto and parcels. The code already includes truck/`moving` (moving services); its commercial inclusion requires an explicit decision and its own criteria before enabling it to the public.
- Use the following figures as budget guidance; hiring services will be a later milestone.

**Summarized history:** revisions 2–4 set phone/OTP, integrated navigation and three environments with simulated OTP in Development. Revisions 5–9 organized the ten phases and recorded F01, F02-A/B, APK and the HTTPS recovery. On 2026-09-13 Google was verified in Development and password access was removed. On 2026-09-14 those changes and driver registration with several vehicles were merged into `main`. The historical details remain in the [implementation plans](../implementation-plans/0010-phone-identity-and-otp.md). Revision 10 corrected statuses, practical dependencies and next deliveries. Revision 11 adds the local evidence of UI and of the taxi/mototaxi flow on the working branch; it does not close the production certification. Revision 12 verifies the fix of H01–H05, manual ETA and route profiles per service. Revision 13 adds persistent pickup coordination, offer confirmation and protection against late reconnections; it verifies both roles and visual accessibility. Revision 14 incorporates the feedback from the user's tests: closing without an internal cancellation error, automatic ETA, traffic-aware routes and a stable map. Revision 15 verifies several negotiations per driver and passenger, independent submissions and a single assignment even with simultaneous acceptances. Revision 16 fixes four reproduced concurrency, pagination and request-version bugs. Revisions 17–21 add test coverage, ride experience, shared components and map fixes. Revision 22 adds GPS tracking and Android navigation; revision 23 deprecates Testing. Revision 24 records that everything is merged into `main` (PRs #16–#19) with remote CI passing, the visual identity and exact A/B pins.

## 2. Roadmap by phase

Each phase produces a reviewable delivery. The suggested PRs order implementation units; not all of them are PRs that were created. F01, F02 and the early driver work are merged in the history of PR #15. A phase only closes with its criterion and evidence, even if part of the code already exists. The following dependencies are **closing** dependencies: they allow moving independent work forward without considering the previous phase finished.

| Phase | Delivery | Dependencies to close | Status |
|---|---|---|---|
| F01 | Technical foundation and environment policy | None; starting point. | Completed locally |
| F02 | Phone, OTP and social accounts | F01. | In progress: A/B/C code merged; SMS, Testing and recovery to complete; Facebook postponed |
| F03 | Countries, base panel and feature flags | F01–F02. | Pending: F03-A planned; B/C postponed, needed before launch |
| F04 | Drivers and ride operations | F02–F03. | Partially in progress: sign-up, several vehicles and modes implemented; operations pending |
| F05 | Tracking, maps and notifications | F04. | Partial: private GPS and recovery implemented; phone tests, push and closing maps missing |
| F06 | Driver navigation | F05; the native compatibility test can move ahead to F01. | Partial: Android Google Navigation and Waze implemented; walkthrough certification pending |
| F07 | Payments, commissions and settlements | F03–F04; can move in parallel with F05–F06. Sandbox and provider contract to close the integration. | Pending |
| F08 | Complete parcels | F04–F07 to close the full flow; forms and statuses can move ahead. | Pending |
| F09 | Production certification and compliance | F01–F08 and availability of budget/providers. Run the current trials in Development; agree on the future infrastructure before launch. | Pending |
| F10 | Google Play and gradual launch | F09. The Play account and preparing the listing can move ahead. | Pending |

**Main sequence:** F01 → F02 → F03 → F04 → F05 → F06 → F08 → F09 → F10. F07 starts from F03–F04, can move along with F05–F06 and must also finish before F08. With a single person, use the numeric order F01–F10.

**Work that can be moved ahead:** prepare accounts, Play requirements and quotes from F01; move F06-A ahead to check native compatibility; run QA and phone-to-phone walkthroughs in Development; Testing is not provisioned while it is deprecated. Hosted infrastructure is certified in F09. These tasks keep their phase number and do not alter their closing dependencies.

### Next deliveries from this revision

| Order | Concrete work | Evidence to consider it done | Dependency / required owner |
|---|---|---|---|
| 1 | Complete the visible entry to recovery and certify the current candidate (`main`) in Development on two Android phones | API/migrations and Development APK identified by commit; phone, Google, session, number change, recovery request and passenger/driver ride with GPS/navigation tested on phones; remote CI linked (already green on `a5246b7`) | Development + a person doing QA; recovery approval in F03-B |
| 2 | Implement F03-A per plan 0011 | Zone and currency in backend/mobile, compatible amounts and a backfill tested on disposable PostgreSQL | Development; can move ahead while the SMS provider is decided |
| 3 | Complete F03-B/C and the administrative part of F04-A | An operator reviews vehicles/documents and recovery with permissions/audit; flags control new operations | Development + definition of support owners |
| 4 | Complete F04-B/C and F05; move F06-A ahead | Ride on two phones, authorized location and recovery; native navigation test resolved | Android QA and a bounded maps budget |
| 5 | F06, F07 and F08 | Integrated guidance and a complete service with cash/QR, commission and parcel delivery | QR provider, commercial rules and operations |
| 6 | F09 and F10 | Hosted and certified candidate, restoration/load, privacy and an accepted AAB; launch by zones | Budget, providers, owners and a Play account |

**Parallel track that cannot be left to the end:** choose the SMS provider and implement its adapter in F02-C; get QR quotes for F07; confirm the Play account type, initial city/zone, monthly budget and support team. Facebook remains postponed and disabled; it does not block independent tasks. Before certifying F09, record whether it enters this launch or stays disabled as an optional alternative.

**Launch date:** to be defined after closing scope, team and providers. No date is promised based only on the number of phases. The next measurable milestone is the current candidate walked through in Development on two phones, with access and ride documented; that is not a commercial launch yet. While Testing stays deprecated, the F02 exit criterion items that mention the Testing APK and Google in Testing remain open; reactivating Testing or redefining those items is a user decision.

**How to execute and track**

- Take a phase and its first pending PR, review the existing code and settle its contract before editing. If it crosses backend/mobile, update both and their tests together.
- Keep per phase: status (Pending / In progress / Blocked / Completed), owner, PR links, evidence, observed cost and blockers. Do not consider a phase closed just because code was merged.
- Close with proportional tests, reviewed migrations, a demonstration of the flow and resolved risks. F09 gathers the certification of the whole system.
- Do not set dates without team and provider availability. An external blocker prevents the corresponding closing, but allows continuing with authorized independent tasks.

### Commercial and operational work in parallel

It starts together with F01 and does not prevent preparing the project locally. QR terms/sandbox are a closing requirement of F07; budget, permits, owners and real providers are requirements of F09–F10.

- Record the launch zones, available services, hours and support owners.
- Review with local counsel the conditions applicable to transport, moto, parcels, insurance, driver contracts, taxes and invoicing.
- Get quotes from a Bolivian gateway that supports dynamic QR, payment queries, verifiable notifications, refunds and settlements. Confirm contractually that it supports ViajaYa's collection and commission model.
- Define in the commercial configuration the commission percentage, settlement calendar, treatment of cancellations and debt limits for cash.
- Prepare business accounts with providers, domain, email and Google Play, with recoverable access and identified owners.
- Certify the real OTP delivery with Bolivian carriers through a bounded production check before launch, with a budgeted cost; simulation does not certify SMS delivery. Development and testing never call the real OTP provider. Enable production SMS destination countries by configuration, according to commercial coverage, without assuming worldwide delivery.
- Get a quote for the Google Navigation SDK and validate its terms for a mobility app, in addition to Maps/Places/Routes. Measure the real usage before committing to a volume contract.

### Phase 01. Technical foundation and environment policy

**Status:** Completed and verified locally; merged into `main` through PR #15. **Evidence:** [plan 0009](../implementation-plans/0009-environment-foundation.md). The remote CI of `main` (`a5246b7`, 2026-09-24) passed its 5 jobs. Hosting and deployment certification remain in F09.

**Goal:** Keep Development reproducible and preserve the isolation of future configurations. Testing stays inactive until a new decision.

**Dependencies:** None; starting point.

**Deliveries in order:**

- [x] F01-A · Validated configuration of the three environments and examples without secrets.
- [x] F01-B · Android variants, identities and separate API destinations.
- [x] F01-C · Reproducible images, CI and simulated provider contracts.

**Scope and technical decisions**

**Operational status of the configurations**

| Environment | Purpose and deployment | Data and integrations | Android app |
|---|---|---|---|
| Development | Daily work on the developer's computer, local API and services; validate changes before a PR | Resettable fictitious data, simulated payments and simulated OTP with autofill, always without an external provider | EAS profile `development`; name ViajaYa Desarrollo and identifier `com.viajaya.app.dev` |
| Testing — temporarily deprecated | Inactive for current work; definition kept as a reference | Own database and cache; synthetic data, sandbox gateway and simulated OTP with autofill without SMS or provider charges; limited maps trials when necessary | EAS profile `preview`; name ViajaYa Pruebas and identifier `com.viajaya.app.testing` |
| Production — future | Public service for passengers, drivers and real operations; only certified versions | Real data, real payment gateway, production credentials, backups and permanent monitoring | EAS profile `production`; name ViajaYa and identifier `com.viajaya.app` |

The profiles and their validations are kept for compatibility. Only `development` is used: functional QA, phone-to-phone integration and the APKs of this delivery point to Development. The Testing APKs and resources cited in earlier evidence are historical; they do not represent a current operational environment.

**Isolation kept for the future launch**

- Each environment has its own API, PostgreSQL, Redis/Valkey, document storage, operational accounts, flags and secrets. Do not share data resources between testing and production. The testing API and panel are restricted to the team and testers.
- Assign different URLs to the API, WebSocket, panel and webhooks; the concrete domain is configured when it is hired. The server validates its environment on startup and rejects cross combinations or local values in production.
- Separate signing and session validation keys, issuer/audience identities, service accounts and permissions. A development or testing token must be rejected by production, even if the phone numbers are the same.
- Separate Google Maps and Navigation projects/credentials, OAuth clients, Facebook test apps or configuration, gateway keys and webhook secrets. Configure Android signatures, redirects and quotas for the corresponding identifier.
- Isolate OTP, email and push per environment. OTP is exclusively simulated and autofilled in development, without credentials or calls to the real provider. For email and push, keep simulations/sandbox or authorized test recipients depending on the integration. Fixed codes, test autofill, simulated payments and test modes must cause a configuration rejection if someone tries to enable them in production.
- Keep mobile update destinations and runtime configuration separate, tied to their build and environment. The production app offers no server selector; development and testing have a distinctive name and an environment indicator to avoid confusion, and can be installed next to production.
- Promote flag rules and versions explicitly; enabling them in testing must not enable them in production. Identify the environment in logs, errors, alerts, backups and spend metrics, with their own access and retention.
- Use synthetic data; if a real case needs to be reproduced, anonymize it through a reviewed procedure. Do not copy personal data, documents, tokens or production secrets to development or testing.

**Initial technical preparation**

- Create reproducible images and dependencies, CI checks and provider configuration contracts. Prepare the simulated OTP mode exclusively for development; its flow and autofill are implemented in F02.
- Declare infrastructure, URLs, required secrets and promotion without hiring or automatically provisioning paid services. Do not create a fourth environment.
- Record the early Google Navigation/Expo 56 compatibility test as task F06-A if it is worth clearing that risk early.

Isolation is built from F01 and kept in every phase. Full promotion is run and certified in F09; separating data or credentials is not postponed until then.

**Check and evidence:** Documented startup on Windows, validation of valid/invalid configurations, cross tokens rejected and identifiable builds. No secret is added to the repository.

**F01 exit criterion:** Development works reproducibly; CI checks isolation and the rejection of insecure configurations. The historical definitions of the other environments are kept; Testing is not operated and is not a requirement of the current work. The future production infrastructure will be certified in F09.

**Cost or external dependency:** It can start locally without hiring cloud or SMS. Currently only Development is operated; Testing is neither budgeted nor provisioned.

**Recorded verification (2026-09-09):** 649 backend tests passing; 69 opt-in PostgreSQL/Redis tests skipped. 235 mobile tests, Ruff, TypeScript, lint and contracts passing. Three Android projects generated, Hermes bundle compiled, Docker image built and a smoke against disposable PostgreSQL passing. Compose configuration and workflow validated.

**Delivery limits:** the historical Development APK verification of 2026-09-09 was added to the initial native generation; it certifies neither the production AAB nor a full ride with the current version. Mobile OTP was already implemented in F02. There is no record of certified permanent hosting. Current access requires managed sessions; legacy tokens were removed in F02.

### Phase 02. Phone, OTP and social accounts

**Status:** In progress; A/B/C code merged into `main`. Google verified in Development on 2026-09-13; there is historical evidence of HTTPS and the F02-B APK in Testing. Updating/certifying that candidate, wiring real SMS and completing the recovery experience are missing. **PR:** #15, merged. **Owner of the next closing:** to be assigned. **Evidence:** [plan 0010](../implementation-plans/0010-phone-identity-and-otp.md).

**Goal:** Allow signing in or signing up with phone and OTP, with optional Google/Facebook and recovery without dead ends.

**Dependencies:** F01.

**Deliveries in order:**

- [x] F02-A · Stable identity, OTP challenge and a form with simulated autofill, verified in isolation. Activation in the unified access: F02-B.
- [x] F02-B · Code of the unified mobile flow, sessions, number change and access recovery.
- [x] F02-B · Enable both APIs and verify OTP, accounts and sessions against the local services.
- [x] F02-B · Public HTTPS through ngrok and the initial Testing APK historically verified.
- [ ] F02-B · Update API/migrations and the Testing APK from the same candidate; walk through access, session, number change and ride on a phone.
- [ ] F02-B · Restore a visible entry to access recovery and test it. The controller/use case exists; the current single screen does not expose that flow. Operator approval closes in F03-B.
- [x] F02-C · Google: credentials, native dev build and linking walkthrough verified in Development (emulator and phone, 2026-09-13).
- [ ] F02-C · Google in Testing: Android client with the EAS signature, API configuration and a `preview` APK, real walkthrough documented.
- [ ] F02-C · Choose an SMS provider and implement the real adapter, with errors, limits and contract tests. Bounded real delivery in production: F09.
- [ ] F02-C · Facebook: postponed per the 2026-09-13 decision; keep it disabled until its configuration/verification is resolved and it is certified. Confirm its inclusion before F09.

**Scope and technical decisions**

- Replace the separate login/sign-up screens with **Continuar con teléfono**, with a country selector and an initial +591 prefix. Normalize to E.164; accept foreign numbers when the provider and configuration allow it.
- Main flow: **phone → OTP code → existing account or complete name and terms → home**. The code arrives by SMS in production and is simulated/autofilled in development and testing. Do not ask for email or password to use this access. Resolve whether the account exists after verifying the code, with responses that do not allow enumerating registered phones.
- Keep **Continuar con Google** and **Continuar con Facebook**. The backend verifies the provider identity and, on the first access without a verified phone, requests **number → OTP → complete data/terms**. The social identity alone does not allow requesting rides or driving.
- A valid session is kept when reopening the app. Do not send an SMS on every opening or every ride. Verify again when changing the number, recovering access or when a security check requires it.
- Model a stable internal account and several linked identities. The verified phone must be unique among active accounts. Link Google/Facebook only with explicit confirmation and proof of both identities; do not merge by email match or by an unverified historical phone.
- Store OTP challenges with expiry, single use, number, purpose and provider identifier. Limit attempts, resends and requests per number, IP and device; handle wrong and expired codes, delayed SMS and provider errors. Do not store codes or tokens in logs.
- Issue operational credentials only after the required verification; sign-up must be idempotent to avoid duplicates on retries or simultaneous requests. Add per-device sessions, refresh rotation, reuse detection and HTTP/WS revocation.
- Allow editing and verifying a new number through re-authentication; revoke sessions when appropriate. If the number is lost, offer assisted and audited recovery, considering recycled numbers or conflicting accounts. F02 implements the request, the protected use case and its audit; the operator tool and its full walkthrough close with the panel in F03-B.
- Keep ID, history, role and earnings when linking social identities with proof of both identities and OTP. Do not elevate roles during sign-up; drivers keep the F04 approval. The historical password transition was removed by explicit decision on 2026-09-13, with no real users.
- Remove email/password from the new mobile flow. **Done on 2026-09-13, before production and by the user's decision:** `/auth/register`, `/auth/login`, `/auth/oauth/{provider}` and `/auth/phone/link-legacy` were removed, migration `0026` deleted the hashes and accounts without a verified phone can no longer sign in (there were no real users). There is no password flow at all.
- Keep the reinforced authentication of the admin panel; the simple access for passengers and drivers does not remove that requirement. Keep abuse limits on offers, requests and WS, and timeouts on external verifications.


**OTP without provider cost in lower environments**

- In **development and testing**, always use a simulated OTP adapter inside the backend, without send or verify calls to Twilio or another external provider. These deployments do not receive SMS provider credentials; there is no fallback to real sending if the simulator fails.
- Generate a test code per challenge and keep the same purpose, phone, expiry, attempts and single-use checks as the normal flow. Avoid a universal code that allows skipping verification.
- Only the backend of a lower environment can return the `test_code` field in the challenge response. The mobile variant of that environment autofills the form and shows **OTP de prueba · sin SMS**. The user taps Continue and the backend verifies the challenge; autofill is not equivalent to signing in automatically.
- Allow disabling autofill in development to enter wrong codes and rehearse expiry, resends, limits and simulated provider failures. Retries stay local and free with respect to the OTP provider.
- Apply this simulation to phone access, to the OTP step after Google/Facebook and to number change/recovery verifications. Every account and verification obtained this way stays in its isolated environment.
- Select the mode through deployment configuration validated on startup, not through parameters sent by the app or a commercial flag that could be enabled in production. The production server rejects the simulated configuration, does not return `test_code` and does not accept challenges or tokens from lower environments. The production build excludes the test autofill helper.
- The autofill the operating system may offer from a real SMS in production is independent: that SMS can incur charges. The saving here comes from nothing being sent or verified with an external provider in lower environments.

**Acceptance:** the development OTP flow is completed with the autofilled field and **zero calls to the external provider**; production keeps real verification and does not expose test codes. The compute/hosting cost of the simulator stays within the environment budget.

**Check and evidence:** Wrong, expired and reused OTP; resends; session loss; concurrent sign-ups; social linking and migration keeping ID, role and history. Absence of test_code in the production contract.

**F02 exit criterion:** Sign-up, access, sessions and number change work without duplicate accounts or role changes, also in the updated Testing APK. The recovery request is accessible from the app and its use case/audit are tested; the walkthrough with an operator closes in F03-B. Lower environments make zero OTP calls; the production adapter is implemented and contract-tested without allowing simulation. Real SMS delivery is certified in F09. Google is certified in Testing; Facebook keeps an explicit state of either enabled and certified or postponed and disabled.

**Cost or external dependency:** Development OTP: zero external charges. The OAuth accounts and the real adapter are prepared here; reserve budget to certify production SMS in F09.

### Phase 03. Countries, base panel and feature flags

**Status:** Pending implementation. F03-A has [plan 0011](../implementation-plans/0011-territories-and-currency.md); F03-B/C were postponed on 2026-09-13, but are still launch requirements. **Owner:** to be assigned. **PR and implementation evidence:** to be recorded.

**Goal:** Control administrative access and availability by territory, leaving international expansion prepared.

**Dependencies:** F01–F02.

**Deliveries in order:**

- [ ] F03-A · Country, zone, currency and time zone; Bolivia as the initial configuration.
- [ ] F03-B · Base panel, reinforced access, roles, audit and assisted recovery.
- [ ] F03-C · Backend flags and capabilities consumed by the app.

**Adjustment before F03-A:** the current Alembic head is `0028_driver_vehicles`; `0026` and `0027` are already taken. Create revisions after the current head, without reusing IDs. The `BO-ALL` zone preserves compatibility in lower environments; it is not equivalent to commercially enabling all of Bolivia. Define launch zones before F10.

**Scope and technical decisions**

**Territories and currency**

- Replace the fixed Bolivia rules with a catalog of countries and zones.
- Associate rides, offers, payments and settlements with their zone and currency.
- Keep decimal amounts; prevent adding or settling different currencies.
- Store dates in UTC and compute operational workdays according to the corresponding time zone.
- Normalize international phones, allowing a foreign visitor to use ViajaYa in Bolivia.
- Separate payment, messaging and document-requirement providers per market.

**Base panel and capabilities**

Create the structure of the internal web panel and complete countries, zones and permissions now:

- Manage countries, zones, services and availability.
- Prepare the indicators contract; wire operations in F04–F05 and spend/finance in F07–F09.

Implement separate permissions for administration, support and finance, reinforced authentication and a record of who changed what.

- Add the assisted recovery tool on top of the F02 contract, with authorization, session revocation and audit. Certify here the full flow between user and operator.

Flags will be evaluated in the backend and will allow enabling services, payment methods and features per country, city and user group. The app will receive the configuration to present the available options.

Include flags for Google/Facebook, countries authorized for SMS, integrated Google navigation and the Waze alternative. If the OTP service fails, pause sign-ups/access that require verification and offer a retry; never skip the check as a fallback. Navigation changes must not cut a guidance session or a ride already started either.

**Turning off a feature will block new operations and allow existing rides and payments to finish.** The internal Redis, outbox and scheduler parameters will keep their technical deployment procedure.

**Check and evidence:** Permissions per role and zone, decimal amounts, time zones, international phones and flags turned off during an active ride. The operational and financial modules are completed in F04 and F07.

**F03 exit criterion:** A zone is enabled with permissions and audit; turning off a feature keeps active operations. The panel completes the assisted recovery of F02. The structure admits another country without mixing currencies.

**Cost or external dependency:** It can be developed with synthetic data and a local panel; the catalog does not commercially enable any new country.

### Phase 04. Drivers and ride operations

**Status:** Partially in progress, with early work merged in PR #15. **Already implemented:** registration from Profile, one vehicle per type (`taxi`, `moto`, `truck`), compatible services, review statuses and mode/vehicle selection. **Missing:** documents, administrative review and exception operations. **Closing owner:** to be assigned. **Evidence:** migrations `0027`/`0028`, driver use cases and tests; [2026-09-19 review](production-readiness-2026-09-19.md).

**Goal:** Enable approved drivers and resolve the normal and exceptional operation of the ride from the app and the panel.

**Dependencies:** F02–F03.

**Deliveries in order:**

**Local progress of the flow (revision 21):** simultaneous negotiation, single assignment, arrival → «ya salí» → start → closing and rating. Offer comparison, visible contact, stable panels and shared components are kept. Automatic arrival accepts Google's valid 0 s response next to the pickup point; errors distinguish provider, nonexistent route, timeout and connection. Configure shows controls over the map and search uses the measured space, even with large text. Every map disables buildings/interiors/tilt and hides relief geometry. Evidence: **396 mobile tests**, **68 UI cases**, **six real Google queries**, TypeScript/lint and an updated Android bundle. Native cartography and shading when zooming require confirmation on a phone; there are no ADB devices connected. Backend unchanged: revision 17 with **731 backend tests** (90 skipped and five existing warnings) and **9 PostgreSQL** on a disposable database. It does not close shared GPS tracking, integrated navigation or payments. [Nearby arrival and maps 0021](../implementation-plans/0021-nearby-arrival-and-clear-maps.md).

- [x] F04-A · Registration and management of vehicles/services from the app, pending status and mode/vehicle switching.
- [ ] F04-A · Private documents, review/approval by an operator, suspension and expirations. Auto-approval only in lower environments; it never replaces this closing.
- [ ] F04-B · Eligibility, availability, coverage and verified pickup.
- [ ] F04-C · Cancellations, incidents and audited support tools.

**Scope and technical decisions**

- Add a sign-up request, private document upload, review, approval, rejection, suspension and expirations.
- Allow only approved, available drivers enabled for that service and zone to receive requests.
- Filter requests by proximity and coverage; limit the personal data and exact locations exposed before assignment.
- Implement cancellation reasons, absent passenger, incidents and resolution of stuck rides.
- Offer support from the ride and history, with a human attention procedure.
- Add vehicle identification and pickup verification to reduce passenger or parcel errors.

**Panel operations module**

- Review drivers, documents and vehicles.
- Look up rides and incidents and resolve exceptional operations through audited actions. Payments, settlements and pending commissions are added in F07.
- Wire operational indicators and the human attention procedure.

**Check and evidence:** Expired document, suspension, driver out of zone, cancellation, absence and incident. Matching keeps the atomic assignment and current rules.

**F04 exit criterion:** Only approved and eligible drivers receive requests; support resolves incidents without editing the database and the information exposed before assigning is limited.

**Cost or external dependency:** The software can be tested locally. The launch will need people for document review, support and operations.

### Phase 05. Tracking, maps and notifications

**Status:** Partial local delivery: authorized GPS publication, private WebSocket, recovery by snapshot, stale signal and Android service. API/WS, Redis between instances and UI with doubles were tested. A trial with two phones, push and the app's own maps queries from the backend are missing. **Certification owner:** to be assigned. **Evidence:** [0022](../implementation-plans/0022-driver-navigation-and-live-tracking.md).

**Goal:** Keep ride location and status reliable for passenger and driver, with controlled maps and usage.

**Dependencies:** F04.

**Deliveries in order:**

- [x] F05-A · Authorized GPS reporting, accuracy and a stale-location notice; local verification in 0022.
- [ ] F05-B · Android continuity, realtime recovery and notifications.
- [ ] F05-C · Maps/Places/Routes from the backend, errors, quotas and metrics.

**Scope and technical decisions**

- Send the driver's location with time and accuracy; show their real position to the authorized passenger.
- Detect stale positions and communicate signal loss.
- Keep tracking during the service with the appropriate Android permissions and mechanisms; stop it when finishing or going out of service.
- Add push for acceptance, arrival, cancellation and relevant news. When opening a notification, query the current state.
- Keep the offer expiry of **30 seconds** and the passenger presence grace of **120 seconds**.
- Move the app's own HTTP queries to Places, Routes and geocoding to the authenticated backend, with limits, cancellation and timeouts. The native Navigation SDK is integrated on Android and uses its own connection mechanisms and restricted credentials; it does not become a backend HTTP query.
- Separate native and server credentials, restricting them by app, signature and API as appropriate; control requested fields and recalculations.
- Show route errors explicitly.

- Keep WebSocket as the primary path, recovery by snapshot and polling as a slow fallback. Automatic cancellation on absence only affects SEARCHING rides; the driver's GPS does not modify this rule.

**Check and evidence:** Two phones, denied permissions, stale GPS, slow network, reconnection and a push that recovers the snapshot. Absence cancellation only affects SEARCHING.

**F05 exit criterion:** Tracking recovers after disconnection, background and app switching; it keeps 30-second offers and the 120-second passenger presence.

**Cost or external dependency:** Use doubles in automation and limit real maps trials. Do not confuse free OTP in lower environments with Google Maps being free.

### Phase 06. Driver navigation

**Status:** Partial local delivery: Google Navigation 0.16.3 on Android, stages per active ride, voice control and Waze. Build and local tests recorded in [0022](../implementation-plans/0022-driver-navigation-and-live-tracking.md); certification with real GPS, a Google account and two phones pending. **Certification owner:** to be assigned.

**Goal:** Guide inside ViajaYa to the pickup and destination with Google Navigation, keeping Waze as an external option.

**Dependencies:** F05; the native compatibility test can move ahead to F01.

**Deliveries in order:**

- [x] F06-A · Wrapper 0.16.3 with Expo 56/RN 0.85.3: debug APK built and configuration regenerated; see 0022. Certification on a phone is still pending.
- [ ] F06-B · Integrated guidance, voice, ETA, detours and stage change.
- [ ] F06-C · Recovery, optional Waze and measurement of billable requests.

**Scope and technical decisions**

**Driver navigation inside ViajaYa**

- Add the Google Navigation SDK with turn-by-turn instructions, voice, distance, ETA and recalculation on detours. Cover **driver → pickup** and **pickup → destination** for taxi, moto and parcels, using the vehicle mode available and validated in each country.
- The screen keeps the ride's necessary actions with large controls and little interaction. Change stage only after the corresponding pickup/start confirmation; an SDK arrival event does not automatically complete the service or confirm its payment.
- Use the backend's active ride as the source of destinations and status. Resume the correct stage when returning to the app and avoid requesting destinations again on every render, GPS sample or reconnection; measure the calls that generate charges.
- Keep GPS reporting to ViajaYa and per-participant authorization. Google navigation does not replace the tracking the passenger sees or the presence of the realtime system.
- Certify denied or disabled GPS, lost network, missing route, invalid quota or credential, voice, Bluetooth, screen lock and returning from background. Show recovery actions; do not promise full offline navigation without checking real support.
- First run an integration test with **Expo 56 and React Native 0.85.3**, a signed Android build and the existing maps. Google's wrapper is beta and its requirements change: select a compatible version and verify native dependencies before pinning it, without blindly updating Expo/RN. Generate a new binary with the integration and reproducible configuration. [Official Google wrapper](https://github.com/googlemaps/react-native-navigation-sdk), [native development in Expo](https://docs.expo.dev/workflow/customizing/).
- Validate real routes in the Bolivian zones, available moto features, permissions, terms and attributions. Do not announce features without verified coverage. [Navigation SDK coverage](https://developers.google.com/maps/documentation/navigation/android-sdk/coverage-nav-sdk).

**Waze as an external alternative**

- Offer **Abrir en Waze** through a deep link, started by the driver and with the destination of the current stage. Waze's public SDK does not allow embedding its map and navigation inside ViajaYa. [Official limitations](https://developers.google.com/waze/intro-transport), [deep links](https://developers.google.com/waze/deeplinks).
- If Waze is not installed, offer continuing with integrated Google. On return, recover the active ride. Do not run two voice guidances at once; keep ViajaYa's authorized tracking while the driver uses Waze.
- Do not assume that a deep link returns Waze's location, route or ETA; a possible partner integration would require separate access and validation. Waze is optional and does not by itself meet the in-app navigation criterion.


Location with the app minimized must be justified and declared according to the [Google Play requirements](https://support.google.com/googleplay/android-developer/answer/9799150?hl=en).

**Check and evidence:** Taxi, moto and parcel in target zones; failed GPS/network/credentials, Bluetooth, locked screen, Waze installed/missing and returning to the correct stage.

**F06 exit criterion:** A real trip completes both stages with integrated guidance, a single voice and passenger tracking. The SDK arrival does not complete the ride or its payment; there are no duplicate requests per render or reconnection.

**Cost or external dependency:** The real test needs a Google account and a limited budget. If the beta integration is not compatible, resolve the blocker before committing the feature; do not silently replace it with Waze.

### Phase 07. Payments, commissions and settlements

**Status:** Pending. **Owner:** to be assigned. **PR and evidence:** to be recorded.

**Goal:** Record and reconcile QR and cash, with commissions, driver debt and traceable settlements.

**Dependencies:** F03–F04; can move in parallel with F05–F06. Sandbox and provider contract to close the integration.

**Deliveries in order:**

- [ ] F07-A · Amounts, frozen commission, accounting ledger and cash.
- [ ] F07-B · QR, provider verification, webhooks and idempotency.
- [ ] F07-C · Debt, refunds, reconciliation, settlements and finance panel.

**Scope and technical decisions**

Currently selecting "QR" does not process a transaction. The full circuit is needed:

- Separate service status and payment status: finishing a ride does not mean having collected.
- Generate a QR per payment obligation, with amount, currency, reference and expiry.
- Confirm payments from the provider; handle duplicate and late notifications and retries without duplicating charges.
- Store the fare and commission rule applied when accepting the service.
- Implement an auditable accounting ledger of collections, commissions, refunds, adjustments and settlements.
- For cash, record the driver's declaration of collection and the commission owed, with the possibility of a claim.
- Offset pending commissions against QR settlements and allow paying them via QR.
- Apply configurable debt limits to new operations, keeping the completion of active services.
- Reconcile the records daily with the provider and have a discrepancy queue for finance.
- Replace the empty wallet with real payment and settlement screens.

**Panel finance module**

- Look up collections, settlements and pending commissions with finance permissions.
- Resolve discrepancies, claims and adjustments through audited actions; wire operations and spend indicators.
- Build cash and the ledger first, then QR and finally reconciliation/debt/settlements; keep backend/mobile contracts in every PR.

**Check and evidence:** Duplicate/late notifications, expired QR, disputed cash, debt limits, refund and failed settlement; reconciliation without duplicating money.

**F07 exit criterion:** Every amount is explained from the service to the collection, commission and settlement after retries or outages. The QR integration passes the provider sandbox; real payments are certified in F09.

**Cost or external dependency:** Model and simulated adapters can move forward without a contract. Get quotes for the gateway commission, refunds and settlements before closing the integration.

### Phase 08. Complete parcels

**Status:** Pending. **Owner:** to be assigned. **PR and evidence:** to be recorded.

**Goal:** Complete package pickup, transport, delivery and exception resolution with operational and financial traceability.

**Dependencies:** F04–F07 to close the full flow; forms and statuses can move ahead.

**Deliveries in order:**

- [ ] F08-A · Sender, recipient, package and restrictions.
- [ ] F08-B · Pickup, delivery and receipt confirmation.
- [ ] F08-C · Absences, returns and incidents with audited adjustments.

**Scope and technical decisions**

- Add sender, recipient, phones, description and package limits.
- Report restricted items and service conditions.
- Record pickup, delivery and receipt confirmation through a code.
- Resolve an absent recipient, failed delivery, return and incidents.
- Associate any payment adjustment with an auditable cause and approval.

**Check and evidence:** Correct pickup, wrong/reused delivery code, absent recipient, return and authorized payment adjustment.

**F08 exit criterion:** A parcel is delivered or resolved exceptionally from the app and the panel; status, confirmation, responsibility and applicable amounts are recorded.

**Cost or external dependency:** Validate conditions, restricted items, responsibility and return operations with the commercial track before launching.

### Phase 09. Production certification and compliance

**Status:** Pending operational certification. It reuses the implemented Docker, CI workflow, health/metrics, alert rules and multi-worker support. [Plan 0008](../implementation-plans/0008-architecture-hardening.md) still requires a representative rollout and a real monitoring receiver/perimeter. **Owner:** to be assigned. **Hosted and candidate evidence:** to be recorded.

**Goal:** Certify the complete candidate on hosted infrastructure and check security, recovery, costs and compliance.

**Dependencies:** F01–F08 and availability of budget/providers. Run the current trials in Development; agree on the future infrastructure before launch.

**Deliveries in order:**

- [ ] F09-A · Hosted infrastructure, promotion, migrations and observability.
- [ ] F09-B · Integration, isolation, load, restoration and rollback.
- [ ] F09-C · Privacy, deletion and real provider certification.

**Scope and technical decisions**

Proposed initial architecture: **paid Render**, with a permanent API, managed PostgreSQL with an availability replica, private Redis/Valkey and a static panel. Validate latency from Bolivian mobile networks before choosing a region; Render currently offers no South American region. [Available regions](https://render.com/docs/regions).

- Keep Development separate from the future Production. Testing remains deprecated and must not be reactivated as an implicit part of this phase.
- Create reproducible images and automated deployment with HTTPS/WSS.
- Run migrations through a single process and check compatibility before updating.
- Validate the production configuration: secrets, connections and URLs; reject local or insecure values.
- Complete the gradual promotion of the existing realtime system and certify two replicas.
- Centralize backend and Android errors, sanitized logs, metrics and alerts with a real receiver.
- Protect metrics and administrative tools.
- Configure backups, point-in-time recovery and an external copy; rehearse restoration and rollback.
- Pin dependency versions, secret scanning and mandatory checks to merge changes.

**Current flow: Development; future publication with approval**

- Development: implement on a branch and send a PR. CI runs contracts and tests on disposable temporary databases; these databases are test resources, not a fourth permanent environment.
- Current validation in Development: identify the commit and APK, run functional QA, simulated OTP, OAuth, sandbox payments, navigation and realtime. Use synthetic data and disposable databases for schema, restoration and rollback trials. Do not deploy to Testing.
- Future production: agree on enabling it and promote the certified backend image, with production configuration and secrets. Run compatible migrations through a single process and check health; keep the previous image for rollback. Do not run destructive suites or test seeds on real data.
- Android: generate the environment variants from the same commit. Since their identifiers and credentials are different, also certify the signed production AAB on Google Play's internal/closed track before promoting that same AAB to the public. A distribution track does not automatically change the API the binary points to.
- Record version, environment, test result and the person responsible for the promotion. The public deployment is blocked if the checks fail, there are crossed secrets or simulations remain enabled. Native changes require a compatible binary; mobile updates must not cross environments.

**Privacy and provider certification**

- Publish terms, privacy, support and driver conditions.
- Store a versioned acceptance of the terms.
- Implement deletion requests, anonymization and retention rules per category.
- Provide deletion from the app and an accessible web path: Google Play requires both for apps that create accounts. [Deletion policy](https://support.google.com/googleplay/android-developer/answer/13327111?hl=en-EN).
- Certify Google and any other enabled social provider with production signatures and credentials. Record the decision about Facebook; if it stays postponed, check that it remains disabled.
- Run the technical and compliance certification of section 5 and record evidence of the candidate, environment and version. The Google Play distribution, review and acceptance milestones close in F10 and are not closing requirements of F09.
- Certify real OTP exclusively in production through a bounded, budgeted trial; development always keeps the simulation. Certify OAuth with production signatures and real QR with its provider.
- Confirm measured costs, owners, contracts and limits before authorizing the launch.

**Check and evidence:** Certification matrix report, alert received, restoration RPO ≤ 15 min/RTO ≤ 2 h, API p95 ≤ 500 ms and realtime p95 ≤ 2 s under the target load; deletion and retention trial.

**F09 exit criterion:** Testing and production are hosted and isolated; the candidate passes integration, load and recovery. Real OTP/OAuth/QR/Navigation, commercial terms, privacy and the launch budget have evidence.

**Cost or external dependency:** It requires real spending on hosting and bounded provider trials. With a zero budget this phase is not declared complete and nothing opens to the public.

### Phase 10. Google Play and gradual launch

**Status:** Pending. **Owner:** to be assigned. **PR and evidence:** to be recorded.

**Goal:** Publish the certified AAB and open zones of Bolivia with taxi, moto and parcels operational and monitored.

**Dependencies:** F09. The Play account and preparing the listing can move ahead.

**Deliveries in order:**

- [ ] F10-A · Signed AAB, listing, Data Safety, permissions and Play review.
- [ ] F10-B · Applicable internal/closed testing and installation/update.
- [ ] F10-C · Launch by zones, support, reconciliation and metrics review.

**Scope and technical decisions**

- Complete Data Safety, permission declarations, listing, screenshots and review access.
- Generate and test the signed AAB without depending on Metro.
- Check whether the closed test of 12 participants for 14 days applies, required for certain new personal accounts. [Testing requirements](https://support.google.com/googleplay/android-developer/answer/14151465?hl=en-GB).

- Promote the same internally certified production AAB; changing tracks does not change the binary's API.
- Open zones gradually through flags, with taxi, moto and parcels ready, approved drivers, support and reconciliation available.
- Watch errors, availability, payments and cost per service; if a launch is stopped, block new operations while keeping rides and obligations in progress.
- Extend coverage or capacity according to stability, demand and observed cost. A new country carries its own local certification.

**Check and evidence:** Record of approval and version, results on phones, zone checklist, incident owners and tracking of errors, payments and cost per service.

**F10 exit criterion:** Google Play accepts the binary; the same certified production AAB is promoted. Each enabled zone has approved drivers, support, reconciliation, alerts and active spend limits.

**Cost or external dependency:** Opening gradually by geography contains exposure and spend; the three agreed services must be ready. Expanding to countries requires an independent certification.

### First block completed: F01-A

- [x] Inventory the current backend, mobile, Docker and EAS configuration; identify fixed values and active documentation. Use examples without reading or modifying secrets in the .env files.
- [x] Define the environment contract and its validation: development/production, URLs, issuer/audience, credentials per provider and allowed modes.
- [x] Document the OTP matrix: mandatory simulation in development, a real provider exclusively in production; autofill arrives in F02.
- [x] Update the configuration and examples of both projects and check the acceptance of valid combinations and the rejection of crossed/insecure modes.
- [x] Record local evidence of F01-A, F01-B and F01-C. F02-A/B/C already has an implementation; the next closings are in the next deliveries table.

## 3. Contracts and compatibility

Each cross-cutting block will update backend and mobile together:

| Contract | Addition |
|---|---|
| Authentication | OTP request/verification, unified phone sign-up, Google/Facebook identities, linking, number change, sessions, recovery and revocation |
| Configuration | Countries, zones, currency, services, SMS countries, integrated/external navigation and enabled capabilities |
| Drivers | Requests, documents, approval and eligibility |
| Rides and real time | Authorized location, navigation stage/destination, ETA, incidents and parcel data |
| Money | Payments, commissions, debt, refunds and settlements |
| Administration | Protected actions, permissions and audit |

Keep `/api/v1`, `snake_case` DTOs, mobile mapping and contract tests. Schema changes will carry reviewed migrations and a transition compatible with app versions that are still installed.

The development OTP response may include `test_code` for autofill. The production contract does not include that field; CI must certify its absence and the rejection of any request that tries to enable the simulated mode from the client.

## 4. Budget and spend control

**It is worth separating the fixed cost of keeping the service running from the variable cost of each operation.** Without a defined budget, these references allow deciding when to hire and how much to reserve.

Monthly estimates in USD. Initial references of **September 9, 2026**; public Google Maps/Navigation, Twilio Verify and EAS prices consulted again on **2026-09-19**. The infrastructure bands are kept as our own hypothesis pending a detailed quote; they are neither observed spend nor an approved budget.

| Item | Bounded launch | Preparation for the target capacity |
|---|---:|---:|
| Future infrastructure, backups and monitoring (historical estimate to review) | **300–400** | **700–1,000** |
| Maps | Depending on searches and routes | May exceed the infrastructure cost |
| Integrated Google navigation | Depending on destinations requested from the SDK | Example with two destinations per ride: USD 6,475/month |
| OTP in development | **USD 0 of external sending/verification**, through simulation and autofill | **USD 0 of external sending/verification**; hosting accounted separately |
| Real OTP in production | Depending on sign-ups, sign-ins that require OTP, number changes and retries | Depending on usage and country; not equivalent to an SMS per ride |
| Transactional email | Depending on provider and volume | Depending on provider and volume |
| Gateway and settlements | Depending on contract and collected volume | Depending on contract and collected volume |
| Development, support, insurance and commercial obligations | Separate budget | Separate budget |

The infrastructure bands in this table are historical and included a hosted Testing environment. **They are not the current budget:** Testing is deprecated and only Development is used. Production hosting will be recalculated before hiring it; the figures do not prove capacity. Development API usage is measured separately.

To size maps: **5,000 rides/day × 30 days × 2 routes = 300,000 monthly computations**, approximately **USD 1,250 in Routes Essentials**. Adding, as a hypothesis, one Essentials detail and five autocomplete requests per ride, the total would be approximately **USD 3,488/month**, before geocoding, abandoned searches and additional recalculations. [Google Maps prices](https://developers.google.com/maps/billing-and-pricing/pricing).

That base scenario would give **about USD 4,200–4,500 per month between infrastructure and maps, without turn-by-turn navigation**. It corresponds to the goal of 5,000 daily services; it does not represent the cost of a small pilot or an approved budget. Before hiring, compute another scenario with the pilot's expected number of services, abandoned searches and sign-ins.

**Additional cost of integrated navigation.** At 5,000 rides/day for 30 days, one navigation destination per ride adds 150,000 destinations (approximately **USD 3,475/month**); two destinations, pickup and drop-off, add 300,000 (approximately **USD 6,475/month**). With the conservative assumption of keeping the previous maps queries, infrastructure + maps + two navigation destinations would be **about USD 10,700–11,000/month**, before SMS, gateway, taxes and human operations. These are usage scenarios at public prices, not a quote or the cost of getting started. [Navigation Request prices](https://developers.google.com/maps/billing-and-pricing/pricing).

Billing depends on the requested destinations and the contract; starting the guidance and the later automatic detours have no additional charge by themselves. Avoid duplicate queries between Routes and the SDK and measure whether the integration allows reducing the previous assumption. Ask for mobility/volume terms without assuming discounts. [Navigation SDK billing](https://developers.google.com/maps/documentation/navigation/android-sdk/pricing).

Other usage that must stay visible:

- Real verification in production: Twilio Verify publishes USD 0.05 per successful verification **plus the channel cost**; 1,000 verifications would be USD 50 before the SMS applicable to Bolivia. Get a quote for delivery and the local rate before choosing a provider. Development and testing do not consume this service. [Verify prices](https://www.twilio.com/en-us/verify/pricing).
- Builds and updates: EAS has a free tier and Starter at USD 19/month plus usage. Choose based on real usage. [Expo prices](https://expo.dev/pricing).
- Payments: compute gateway commissions, settlements and refunds on the real contract; do not assume that receiving QR is free.

Implement in Development; keep independent measurement and limits for a future Production:

- Cost indicators per environment, search, ride, navigation destination and country. Measure OTP sending/verification, SMS delivery and retries only for production; in development record simulated challenges and check zero calls to the external provider.
- Alerts at 50 %, 80 % and 100 % of the configured budget.
- Quotas and usage limits, in addition to alerts: a budget alert alone does not stop charges. [Maps cost control](https://developers.google.com/maps/billing-and-pricing/manage-costs).
- Abuse control, minimal Places fields and recalculation limits.
- Margin per service: **commission earned minus gateway, technology usage, adjustments and refunds**.

## 5. Tests and conditions to open to the public

Run each phase through the suggested PRs and check its criteria before closing it. The following matrix is cross-cutting: each behavior is tested in its phase; F09 closes technical integration, compliance, load and recovery. F10 closes the Google Play distribution and acceptance milestones and confirms the operational readiness of each zone. No milestone exclusive to F10 is a requirement to close F09.

The launch requires:

- Full CI passing: backend, PostgreSQL/Redis, contracts, TypeScript, lint and mobile tests.
- Development correctly identified and separated from the future Production: tokens, webhooks and updates do not cross environments. Testing remains deprecated. Cleaning Development or CI resources must not affect future production data.
- Backend promotion through the same certified image and review of the production AAB before publishing. Confirm the rejection of crossed secrets, simulated/fixed OTP, test autofill and a simulated gateway in production; for testing email/push, check the list of authorized recipients.
- Development: walk through phone sign-up, the OTP after Google and after any enabled social provider, and number change with autofill, verifying zero calls to the SMS provider when sending, validating and resending. Disable autofill to check wrong codes, expiry and single use.
- Production: certify that neither parameters, headers, flags nor a lower-environment build enable the simulator or return `test_code`. Real SMS delivery is checked with the production provider in a bounded and budgeted way; simulated tests do not replace it.
- A real walkthrough on two phones for taxi, moto and parcel, including cash and QR.
- Tests of phone sign-up and sign-in, valid/wrong/expired/reused OTP, resend, SMS delay, abuse, number change and recovery without blocked screens.
- Google and any enabled social provider with and without a verified phone; explicit linking, an already registered phone, concurrent sign-ups and migration of existing accounts without losing history or elevating roles. Verify that no operational sessions are issued before the required OTP and that Facebook stays disabled if it remains postponed.
- Tests of an invalid session, a suspended account and revocation; check 404 on the removed email/password endpoints and the rejection of a JWT without a managed session.
- Tests of slow network, reconnection, closing the app, background, denied permissions and stale GPS.
- Google navigation for taxi/moto/parcel to the pickup and destination: voice, detours, arrival without automatic closing, stage change and recovery after restart. Verify Waze installed/missing, returning to ViajaYa, passenger tracking and the absence of duplicate charges per render/reconnection.
- Duplicate or late payments, disputed cash, commission debt, refund and failed settlement.
- Isolation between users, drivers, zones and administrative permissions.
- A sustained test with 500 drivers and an initial hypothesis of 500 connected passengers, plus bursts of double load.
- Initial targets: own API p95 ≤ 500 ms and visible realtime event p95 ≤ 2 s, without duplicate assignments, duplicate charges or false cancellations.
- Restoration rehearsed with a target of RPO ≤ 15 minutes and RTO ≤ 2 hours; a real alert received and the rollback procedure checked.
- Clean installation, update, accessibility and a signed binary accepted by Google Play.
- Approved drivers, available support and working reconciliation in each enabled zone.

Publish first through internal/closed tests and then open zones gradually with the flags. Extend coverage and capacity according to stability, demand and observed cost. Expansion to each new country will be an independent delivery with certified local providers, currency, documents, support and conditions.

## 6. Decisions needed to set the launch

| Decision | Status as of 2026-09-24 | Must be resolved before |
|---|---|---|
| Initial city/zone, pilot volume and support owners/hours | No closed selection is recorded in the reviewed plans | Configuring coverage in F03/F04 and launching in F10 |
| SMS provider, delivery in Bolivia and budget for the real trial | No provider chosen in the latest evidence | Closing F02-C and the F09 certification |
| QR provider, commission, settlements, refunds and cash debt | To be defined/quoted | F07 integration and F09–F10 launch |
| Maximum monthly budget and hosting/region | Estimates, without certified hiring | Provisioning and certifying F09 |
| Google Play account, owner and account type | Not verified | Scheduling F10; check whether the 12 testers/14 days test applies |
| Facebook in the first launch | Postponed; must stay disabled until certification | Closing the social scope of F09 |
| Moving/truck in the first launch | Partial implementation in code, outside the agreed launch scope | Commercially enabling `moving` |

**Update rule:** each closing records date, commit, environment, command or walkthrough, result and limits. Historical results from another version are kept as background and distinguished from the certification of the current candidate.
