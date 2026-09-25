# ViajaYa production launch plan

> Historical snapshot (revision 4) kept as background for the old organization scripts; the current
> plan is `../production-launch-plan.md`.

Date: September 9, 2026. Status: proposed plan; the work described is pending implementation and certification.

Revision 2: main access by phone and OTP, Google/Facebook with a verified phone and driver navigation inside the app.

Revision 3: three explicit environments —development, testing and production— with isolation and controlled promotion of versions.

Revision 4: simulated OTP with autofill in development and testing, without SMS sending or OTP provider charges.

## 1. Goal and starting decisions

Launch publicly on **Android, in Bolivia, with taxi, moto and parcels**, prepared to add other countries. Include **QR payments at the end and cash**, a per-service commission and an **admin panel with feature flags**.

The target capacity will be **500 connected drivers and 5,000 daily services**. It is a goal we must prove with tests; it does not require hiring all that capacity from day one.

The project already has negotiation, atomic assignment, ride lifecycle, history, ratings, WebSockets, outbox, Redis and a base of automated tests. The main pending items are in account security, commercial operations, GPS tracking, payments, parcels and deployment.

Initial decisions:

- Enable coverage by cities and zones from the panel. Publishing in Bolivia will not automatically enable the whole territory.
- Keep the FastAPI monolith and the current app.
- Operate exactly three environments: **development**, **testing** and **production**. Testing is the pre-launch validation environment, also called staging; it is not a fourth environment.
- Unify sign-in and sign-up into **Continuar con teléfono**, without a password for the new flow: **real SMS OTP in production** and **simulated OTP with autofill in development/testing**. Google and Facebook will be optional alternatives, also subject to the phone verification flow of the corresponding environment.
- Offer **turn-by-turn navigation inside ViajaYa with the Google Navigation SDK**, to the pickup and then to the destination. Waze will be a voluntary external option; it does not replace the integrated navigation requirement.
- Add configurable country, currency, time zone and providers. Bolivia starts with `BO`, `BOB` and `America/La_Paz`.
- Leave iOS, international rides and currency conversion for later phases.
- Use the following figures as budget guidance; hiring services will be a later milestone.

## 2. Pending work, in execution order

**1. Prepare operations and providers**

- Record the launch zones, available services, hours and support owners.
- Review with local counsel the conditions applicable to transport, moto, parcels, insurance, driver contracts, taxes and invoicing.
- Get quotes from a Bolivian gateway that supports dynamic QR, payment queries, verifiable notifications, refunds and settlements. Confirm contractually that it supports ViajaYa's collection and commission model.
- Define in the commercial configuration the commission percentage, settlement calendar, treatment of cancellations and debt limits for cash.
- Prepare business accounts with providers, domain, email and Google Play, with recoverable access and identified owners.
- Certify the real OTP delivery with Bolivian carriers through a bounded production check before launch, with a budgeted cost; simulation does not certify SMS delivery. Development and testing never call the real OTP provider. Enable production SMS destination countries by configuration, according to commercial coverage, without assuming worldwide delivery.
- Get a quote for the Google Navigation SDK and validate its terms for a mobility app, in addition to Maps/Places/Routes. Measure the real usage before committing to a volume contract.

**Exit criterion:** each zone has responsible operations and the money integrations have confirmed commercial terms and a test environment.

**2. Simple access by phone, OTP and social accounts**

- Replace the separate login/sign-up screens with **Continuar con teléfono**, with a country selector and an initial +591 prefix. Normalize to E.164; accept foreign numbers when the provider and configuration allow it.
- Main flow: **phone → OTP code → existing account or complete name and terms → home**. The code arrives by SMS in production and is simulated/autofilled in development and testing. Do not ask for email or password to use this access. Resolve whether the account exists after verifying the code, with responses that do not allow enumerating registered phones.
- Keep **Continuar con Google** and **Continuar con Facebook**. The backend verifies the provider identity and, on the first access without a verified phone, requests **number → OTP → complete data/terms**. The social identity alone does not allow requesting rides or driving.
- A valid session is kept when reopening the app. Do not send an SMS on every opening or every ride. Verify again when changing the number, recovering access or when a security check requires it.
- Model a stable internal account and several linked identities. The verified phone must be unique among active accounts. Link Google/Facebook only with explicit confirmation and proof of both identities; do not merge by email match or by an unverified historical phone.
- Store OTP challenges with expiry, single use, number, purpose and provider identifier. Limit attempts, resends and requests per number, IP and device; handle wrong and expired codes, delayed SMS and provider errors. Do not store codes or tokens in logs.
- Issue operational credentials only after the required verification; sign-up must be idempotent to avoid duplicates on retries or simultaneous requests. Add per-device sessions, refresh rotation, reuse detection and HTTP/WS revocation.
- Allow editing and verifying a new number through re-authentication; revoke sessions when appropriate. If the number is lost, offer assisted and audited recovery, considering recycled numbers or conflicting accounts.
- Migrate current users keeping ID, history, role and earnings. Require proof of access to the old account and OTP before linking the phone. Do not elevate roles during sign-up; drivers keep the approval of track 5.
- Remove email/password from the new mobile flow. While an old access exists for migration, fix its 72-byte truncation and do not accept ambiguous credentials without recovery. When closing the transition, disable those endpoints; do not build a new password flow for new users.
- Keep the reinforced authentication of the admin panel; the simple access for passengers and drivers does not remove that requirement. Keep abuse limits on offers, requests and WS, and timeouts on external verifications.

**Exit criterion:** a user can sign up or sign in with their phone without a password, or with Google/Facebook plus a verified phone, without creating duplicate accounts. OTP and session errors offer retry, number change or recovery; suspended or revoked accounts get no operational access.

**OTP without provider cost in lower environments**

- In **development and testing**, always use a simulated OTP adapter inside the backend, without send or verify calls to Twilio or another external provider. These deployments do not receive SMS provider credentials; there is no fallback to real sending if the simulator fails.
- Generate a test code per challenge and keep the same purpose, phone, expiry, attempts and single-use checks as the normal flow. Avoid a universal code that allows skipping verification.
- Only the backend of a lower environment can return the `codigo_prueba` field in the challenge response. The mobile variant of that environment autofills the form and shows **OTP de prueba · sin SMS**. The user taps Continue and the backend verifies the challenge; autofill is not equivalent to signing in automatically.
- Allow disabling autofill in development/testing to enter wrong codes and rehearse expiry, resends, limits and simulated provider failures. Retries stay local and free with respect to the OTP provider.
- Apply this simulation to phone access, to the OTP step after Google/Facebook and to number change/recovery verifications. Every account and verification obtained this way stays in its isolated environment.
- Select the mode through deployment configuration validated on startup, not through parameters sent by the app or a commercial flag that could be enabled in production. The production server rejects the simulated configuration, does not return `codigo_prueba` and does not accept challenges or tokens from lower environments. The production build excludes the test autofill helper.
- The autofill the operating system may offer from a real SMS in production is independent: that SMS can incur charges. The saving here comes from nothing being sent or verified with an external provider in lower environments.

**Acceptance:** the development/testing OTP flow is completed with the autofilled field and **zero calls to the external provider**; production keeps real verification and does not expose test codes. The compute/hosting cost of the simulator stays within the environment budget.

**3. Build the admin panel and feature flags**

Create an internal web panel to:

- Review drivers, documents and vehicles.
- Look up rides, incidents, collections, settlements and pending commissions.
- Resolve exceptional operations through audited actions.
- Manage countries, zones, services and availability.
- Look up operations and spend indicators.

Implement separate permissions for administration, support and finance, reinforced authentication and a record of who changed what.

Flags will be evaluated in the backend and will allow enabling services, payment methods and features per country, city and user group. The app will receive the configuration to present the available options.

Include flags for Google/Facebook, countries authorized for SMS, integrated Google navigation and the Waze alternative. If the OTP service fails, pause sign-ups/access that require verification and offer a retry; never skip the check as a fallback. Navigation changes must not cut a guidance session or a ride already started either.

**Turning off a feature will block new operations and allow existing rides and payments to finish.** The internal Redis, outbox and scheduler parameters will keep their technical deployment procedure.

**4. Prepare territorial expansion**

- Replace the fixed Bolivia rules with a catalog of countries and zones.
- Associate rides, offers, payments and settlements with their zone and currency.
- Keep decimal amounts; prevent adding or settling different currencies.
- Store dates in UTC and compute operational workdays according to the corresponding time zone.
- Normalize international phones, allowing a foreign visitor to use ViajaYa in Bolivia.
- Separate payment, messaging and document-requirement providers per market.

**Exit criterion:** adding a country has clear configuration and extension points. Enabling it still requires commercial, legal and operational certification.

**5. Complete drivers, coverage and service safety**

- Add a sign-up request, private document upload, review, approval, rejection, suspension and expirations.
- Allow only approved, available drivers enabled for that service and zone to receive requests.
- Filter requests by proximity and coverage; limit the personal data and exact locations exposed before assignment.
- Implement cancellation reasons, absent passenger, incidents and resolution of stuck rides.
- Offer support from the ride and history, with a human attention procedure.
- Add vehicle identification and pickup verification to reduce passenger or parcel errors.

**6. Implement integrated navigation, GPS tracking and notifications**

- Send the driver's location with time and accuracy; show their real position to the authorized passenger.
- Detect stale positions and communicate signal loss.
- Keep tracking during the service with the appropriate Android permissions and mechanisms; stop it when finishing or going out of service.
- Add push for acceptance, arrival, cancellation and relevant news. When opening a notification, query the current state.
- Keep the offer expiry of **30 seconds** and the passenger presence grace of **120 seconds**.
- Move the app's own HTTP queries to Places, Routes and geocoding to the authenticated backend, with limits, cancellation and timeouts. The native Navigation SDK is integrated on Android and uses its own connection mechanisms and restricted credentials; it does not become a backend HTTP query.
- Separate native and server credentials, restricting them by app, signature and API as appropriate; control requested fields and recalculations.
- Show route errors explicitly.

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

**Exit criterion:** the driver can go pick up and complete the trip with guidance inside ViajaYa; the passenger keeps the tracking, and failures or app switches do not lose the ride.

Location with the app minimized must be justified and declared according to the [Google Play requirements](https://support.google.com/googleplay/android-developer/answer/9799150?hl=en).

**7. Build payments, commissions and settlements**

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

**Exit criterion:** every amount can be explained from the ride to its collection, commission and settlement, even after a server outage.

**8. Complete parcels**

- Add sender, recipient, phones, description and package limits.
- Report restricted items and service conditions.
- Record pickup, delivery and receipt confirmation through a code.
- Resolve an absent recipient, failed delivery, return and incidents.
- Associate any payment adjustment with an auditable cause and approval.

**Exit criterion:** a delivery can be completed or resolved exceptionally without editing the database.

**9. Prepare infrastructure, deployments and observability**

Proposed initial architecture: **paid Render**, with a permanent API, managed PostgreSQL with an availability replica, private Redis/Valkey and a static panel. Validate latency from Bolivian mobile networks before choosing a region; Render currently offers no South American region. [Available regions](https://render.com/docs/regions).

- Separate development, testing and production according to the isolation and promotion flow defined below.
- Create reproducible images and automated deployment with HTTPS/WSS.
- Run migrations through a single process and check compatibility before updating.
- Validate the production configuration: secrets, connections and URLs; reject local or insecure values.
- Complete the gradual promotion of the existing realtime system and certify two replicas.
- Centralize backend and Android errors, sanitized logs, metrics and alerts with a real receiver.
- Protect metrics and administrative tools.
- Configure backups, point-in-time recovery and an external copy; rehearse restoration and rollback.
- Pin dependency versions, secret scanning and mandatory checks to merge changes.

**Three environments, three purposes**

| Environment | Purpose and deployment | Data and integrations | Android app |
|---|---|---|---|
| Development | Daily work on the developer's computer, local API and services; validate changes before a PR | Resettable fictitious data, simulated payments and simulated OTP with autofill, always without an external provider | EAS profile `development`; name ViajaYa Desarrollo and identifier `com.viajaya.app.dev` |
| Testing | Hosted, private environment for QA, phone-to-phone integration and candidate certification; versions and architecture equivalent to production with adjusted resources | Own database and cache; synthetic data, sandbox gateway and simulated OTP with autofill without SMS or provider charges; limited maps trials when necessary | EAS profile `preview`; name ViajaYa Pruebas and identifier `com.viajaya.app.pruebas` |
| Production | Public service for passengers, drivers and real operations; only certified versions | Real data, real payment gateway, production credentials, backups and permanent monitoring | EAS profile `production`; name ViajaYa and identifier `com.viajaya.app` |

The three EAS profiles already exist in the repository. The full separation of app, infrastructure and integrations still has to be built; a build profile alone is not an isolated environment. Development starts locally to contain costs and make work on Windows easier; testing and production are deployed to the cloud.

**Mandatory isolation**

- Each environment has its own API, PostgreSQL, Redis/Valkey, document storage, operational accounts, flags and secrets. Do not share data resources between testing and production. The testing API and panel are restricted to the team and testers.
- Assign different URLs to the API, WebSocket, panel and webhooks; the concrete domain is configured when it is hired. The server validates its environment on startup and rejects cross combinations or local values in production.
- Separate signing and session validation keys, issuer/audience identities, service accounts and permissions. A development or testing token must be rejected by production, even if the phone numbers are the same.
- Separate Google Maps and Navigation projects/credentials, OAuth clients, Facebook test apps or configuration, gateway keys and webhook secrets. Configure Android signatures, redirects and quotas for the corresponding identifier.
- Isolate OTP, email and push per environment. OTP is exclusively simulated and autofilled in development/testing, without credentials or calls to the real provider. For email and push, keep simulations/sandbox or authorized test recipients depending on the integration. Fixed codes, test autofill, simulated payments and test modes must cause a configuration rejection if someone tries to enable them in production.
- Keep mobile update destinations and runtime configuration separate, tied to their build and environment. The production app offers no server selector; development and testing have a distinctive name and an environment indicator to avoid confusion, and can be installed next to production.
- Promote flag rules and versions explicitly; enabling them in testing must not enable them in production. Identify the environment in logs, errors, alerts, backups and spend metrics, with their own access and retention.
- Use synthetic data; if a real case needs to be reproduced, anonymize it through a reviewed procedure. Do not copy personal data, documents, tokens or production secrets to development or testing.

**Version promotion: development → testing → production**

- Development: implement on a branch and send a PR. CI runs contracts and tests on disposable temporary databases; these databases are test resources, not a fourth permanent environment.
- Testing: deploy the candidate identified by commit and version, apply migrations and run functional QA, simulated OTP with autofill, OAuth, sandbox payments, navigation, realtime and isolation checks. Rehearse schema changes, restoration and rollback before promoting them.
- Production: promote the same certified backend image, with production configuration and secrets. Run compatible migrations through a single process and check health; keep the previous image for rollback. Do not run destructive suites or test seeds on real data.
- Android: generate the environment variants from the same commit. Since their identifiers and credentials are different, also certify the signed production AAB on Google Play's internal/closed track before promoting that same AAB to the public. A distribution track does not automatically change the API the binary points to.
- Record version, environment, test result and the person responsible for the promotion. The public deployment is blocked if the checks fail, there are crossed secrets or simulations remain enabled. Native changes require a compatible binary; mobile updates must not cross environments.

**Exit criterion of track 9:** the three environments are identified and isolated; testing or restarting development/testing does not alter production. A candidate can go through the full validation, promotion and rollback flow with evidence.

**10. Privacy and Android publication**

- Publish terms, privacy, support and driver conditions.
- Store a versioned acceptance of the terms.
- Implement deletion requests, anonymization and retention rules per category.
- Provide deletion from the app and an accessible web path: Google Play requires both for apps that create accounts. [Deletion policy](https://support.google.com/googleplay/android-developer/answer/13327111?hl=en-EN).
- Complete Data Safety, permission declarations, listing, screenshots and review access.
- Generate and test the signed AAB without depending on Metro.
- Certify Google/Facebook with production signatures and credentials.
- Check whether the closed test of 12 participants for 14 days applies, required for certain new personal accounts. [Testing requirements](https://support.google.com/googleplay/android-developer/answer/14151465?hl=en-GB).

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

The development/testing OTP response may include `codigo_prueba` for autofill. The production contract does not include that field; CI must certify its absence and the rejection of any request that tries to enable the simulated mode from the client.

## 4. Budget and spend control

**It is worth separating the fixed cost of keeping the service running from the variable cost of each operation.** Without a defined budget, these references allow deciding when to hire and how much to reserve.

Monthly estimates in USD, with prices consulted on **September 9, 2026**:

| Item | Bounded launch | Preparation for the target capacity |
|---|---:|---:|
| Testing and production infrastructure, backups and monitoring | **300–400** | **700–1,000** |
| Maps | Depending on searches and routes | May exceed the infrastructure cost |
| Integrated Google navigation | Depending on destinations requested from the SDK | Example with two destinations per ride: USD 6,475/month |
| OTP in development and testing | **USD 0 of external sending/verification**, through simulation and autofill | **USD 0 of external sending/verification**; hosting accounted separately |
| Real OTP in production | Depending on sign-ups, sign-ins that require OTP, number changes and retries | Depending on usage and country; not equivalent to an SMS per ride |
| Transactional email | Depending on provider and volume | Depending on provider and volume |
| Gateway and settlements | Depending on contract and collected volume | Depending on contract and collected volume |
| Development, support, insurance and commercial obligations | Separate budget | Separate budget |

The infrastructure bands are our own estimates based on production with two API replicas, PostgreSQL with availability and a private cache, plus a hosted testing environment. Development runs locally and does not add another permanent cloud deployment; its equipment, connectivity and API usage are budgeted separately. Testing was already included as staging, so this clarification does not add a third hosting charge to the previous bands. **They do not guarantee capacity** and must be adjusted with measurements. [Render prices](https://render.com/pricing).

To size maps: **5,000 rides/day × 30 days × 2 routes = 300,000 monthly computations**, approximately **USD 1,250 in Routes Essentials**. Adding, as a hypothesis, one Essentials detail and five autocomplete requests per ride, the total would be approximately **USD 3,488/month**, before geocoding, abandoned searches and additional recalculations. [Google Maps prices](https://developers.google.com/maps/billing-and-pricing/pricing).

That base scenario would give **about USD 4,200–4,500 per month between infrastructure and maps, without turn-by-turn navigation**. It does not represent the full budget of the updated scope.

**Additional cost of integrated navigation.** At 5,000 rides/day for 30 days, one navigation destination per ride adds 150,000 destinations (approximately **USD 3,475/month**); two destinations, pickup and drop-off, add 300,000 (approximately **USD 6,475/month**). With the conservative assumption of keeping the previous maps queries, infrastructure + maps + two navigation destinations would be **about USD 10,700–11,000/month**, before SMS, gateway, taxes and human operations. These are usage scenarios at public prices, not a quote or the cost of getting started. [Navigation Request prices](https://developers.google.com/maps/billing-and-pricing/pricing).

Billing depends on the requested destinations and the contract; starting the guidance and the later automatic detours have no additional charge by themselves. Avoid duplicate queries between Routes and the SDK and measure whether the integration allows reducing the previous assumption. Ask for mobility/volume terms without assuming discounts. [Navigation SDK billing](https://developers.google.com/maps/documentation/navigation/android-sdk/pricing).

Other usage that must stay visible:

- Real verification in production: Twilio Verify publishes USD 0.05 per successful verification **plus the channel cost**; 1,000 verifications would be USD 50 before the SMS applicable to Bolivia. Get a quote for delivery and the local rate before choosing a provider. Development and testing do not consume this service. [Verify prices](https://www.twilio.com/en-us/verify/pricing).
- Builds and updates: EAS has a free tier and Starter at USD 19/month plus usage. Choose based on real usage. [Expo prices](https://expo.dev/pricing).
- Payments: compute gateway commissions, settlements and refunds on the real contract; do not assume that receiving QR is free.

Implement in testing and production, with separate measurement and limits:

- Cost indicators per environment, search, ride, navigation destination and country. Measure OTP sending/verification, SMS delivery and retries only for production; in development/testing record simulated challenges and check zero calls to the external provider.
- Alerts at 50 %, 80 % and 100 % of the configured budget.
- Quotas and usage limits, in addition to alerts: a budget alert alone does not stop charges. [Maps cost control](https://developers.google.com/maps/billing-and-pricing/manage-costs).
- Abuse control, minimal Places fields and recalculation limits.
- Margin per service: **commission earned minus gateway, technology usage, adjustments and refunds**.

## 5. Tests and conditions to open to the public

Run the previous blocks through separate PRs, with their tests and exit criteria. Prepare providers and commercial configuration in parallel with security and the panel; integrate payments and parcels before certifying the full launch.

The launch requires:

- Full CI passing: backend, PostgreSQL/Redis, contracts, TypeScript, lint and mobile tests.
- Three isolated environments: testing tokens, webhooks and updates are not accepted by production; the mobile variant shows its identity and consumes the right API. Test that restarting or cleaning development/testing resources does not touch production data.
- Backend promotion through the same certified image and review of the production AAB before publishing. Confirm the rejection of crossed secrets, simulated/fixed OTP, test autofill and a simulated gateway in production; for testing email/push, check the list of authorized recipients.
- Development/testing: walk through phone sign-up, the OTP after Google/Facebook and number change with autofill, verifying zero calls to the SMS provider when sending, validating and resending. Disable autofill to check wrong codes, expiry and single use.
- Production: certify that neither parameters, headers, flags nor a lower-environment build enable the simulator or return `codigo_prueba`. Real SMS delivery is checked with the production provider in a bounded and budgeted way; simulated tests do not replace it.
- A real walkthrough on two phones for taxi, moto and parcel, including cash and QR.
- Tests of phone sign-up and sign-in, valid/wrong/expired/reused OTP, resend, SMS delay, abuse, number change and recovery without blocked screens.
- Google/Facebook with and without a verified phone; explicit linking, an already registered phone, concurrent sign-ups and migration of existing accounts without losing history or elevating roles. Verify that no operational sessions are issued before the required OTP.
- Tests of an invalid session, a suspended account and revocation; while an old access exists, include its safe handling of long passwords.
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
