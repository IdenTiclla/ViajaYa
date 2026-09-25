# F02 — Phone identity and OTP

Initial date: 2026-09-10. Status update: **2026-09-19**. Phase in progress; A/B/C code merged into `main` through PR #15 (`986dd79`, 2026-09-14). **Google was certified in Development** (emulator and physical phone) on 2026-09-13; Facebook remains postponed per the recorded decision. There is historical evidence of both local APIs, HTTPS through ngrok and an initial F02-B Testing APK. Their current availability was not revalidated. Updating and walking through Testing with the current candidate, implementing the real SMS adapter and making recovery accessible from the entry screen are still missing.

The 2026-09-19 review got 700 backend and 275 mobile tests passing, with Ruff, TypeScript, lint and contracts up to date. It did not repeat PostgreSQL/Redis, builds or phone walkthroughs. [Evidence and limits](../plans/production-readiness-2026-09-19.md).

## Block A scope

- [x] Separate verified identities, linked to the existing account UUID and unique per provider/identifier.
- [x] Random OTP challenges, expiry, attempts, limits per phone/IP/device and resend.
- [x] Single-use verification and a temporary receipt independent of an operational session.
- [x] HTTP contract, generated types and mobile repository through the shared client.
- [x] Reusable mobile controller and form with test autofill, explicit confirmation, retries and an exit to change the number.
- [x] F02-B (code): unified access, test sign-up/terms, per-device sessions, rotation/revocation, number change and recovery.
- [x] F02-B (API): backups, migrations and OTP/session access verified against local Development and Testing.
- [x] F02-B (initial distribution): public HTTPS recovered with ngrok and the F02-B Testing APK verified.
- [ ] F02-B (certification): update Testing with the entry/OTP fixes and complete the manual walkthrough in both variants.
- [ ] F02-B (recovery): expose the request on the current access screen and walk through it; `phoneAccessController` keeps the logic, but `PhoneEntryScreen` does not show that entry. Operator approval depends on F03-B.
- [x] F02-C (code): social access, explicit linking and migration of Google/Facebook accounts with HTTP and PostgreSQL tests.
- [x] F02-C (Google certification, Development): web client + Android client in Google Cloud, dev build with the native SDK and a Google → phone → OTP → linking walkthrough on an emulator and a physical Xiaomi (2026-09-13).
- [ ] F02-C (Google certification, Testing): EAS keystore SHA-1 registered, `TESTING_GOOGLE_OAUTH_CLIENT_ID_WEB` in EAS, `GOOGLE_CLIENT_ID` in the Testing API and the `preview` APK walked through on a phone.
- [ ] F02-C (Facebook): postponed on 2026-09-13; Meta requires business verification to leave development mode. The code is ready and the buttons stay disabled while `FACEBOOK_APP_ID` is empty. Limited Login on iOS remains pending.
- [ ] F02-C (SMS): choose a provider and implement the real adapter. The user confirmed on 2026-09-11 that they have not chosen one yet.

The login and sign-up routes compose the same phone access. The Testing APK downloaded during the handover already includes F02-B; it keeps the version before the fixes and the social access of this continuation.

## Contract and decisions

`POST /api/v1/auth/phone/challenges` receives `phone`, `device_id` (installation UUID) and `purpose=sign_in`. It returns the phone normalized to E.164, `challenge_id`, `expires_at` and `resend_after_seconds`. Bolivia (`BO`) is the initially allowed country; `phonenumbers` metadata validates numbers and `PHONE_OTP_ALLOWED_REGIONS` allows extending the list without hard-coding +591 on the server.

Only the Development/Testing schema admits `test_code`, and the backend omits it if `OTP_TEST_AUTOFILL=false`. The mobile helper can also be disabled with its environment configuration. The Production OpenAPI schema does not contain `test_code`; the production client discards that field even if a wrong response includes it.

`POST /api/v1/auth/phone/verify` adds `challenge_id` and `code`. The result is a `verification_token` valid for five minutes, tied to the phone, device, purpose and environment. It does not work as an access JWT nor reveal whether an account exists. Its consumption happens inside the transaction of the future account operation; a rollback returns the possibility of trying again and a commit prevents reusing it.

Codes have six random digits per challenge, five minutes of validity by default and five attempts. They are stored via HMAC with separation by environment and challenge; the receipt is not stored in plain text either. No universal code is used and no external provider is queried in lower environments. Resending invalidates the previous code and receipt for the same phone/device/purpose.

| Operation | Initial limit |
|---|---|
| Resend per phone | One every 60 seconds |
| Request per phone | Five per 15 minutes |
| Request per device | Ten per 15 minutes |
| Request per IP | Thirty per 15 minutes |
| Verification per device | Thirty per five minutes |
| Verification per IP | One hundred per five minutes |

The windows are shared in PostgreSQL; they do not depend on a worker's memory. Rejections return 429 and `Retry-After`. The IP comes from the ASGI client; the deployment must configure its trusted proxies, without accepting arbitrary client headers as identity.

Migration `0024_phone_verification` adds `user_identities`, `phone_challenges` and `phone_rate_budgets`. It does not change historical IDs, roles or phones, and does not mark old identities as verified. Opportunistic cleanup removes in bounded batches challenges and counters that expired more than a day ago; it does not guarantee timely deletion if the service gets no requests. The general retention policy closes in F09.

## Activation and limits

`PHONE_OTP_ENABLED=false` by default allows preparing the code without enabling access. F02-B needs `0025_managed_accounts`. Development and Testing already have both migrations and access enabled, with prior backups. Activation, backups and the real test report: `local-files/phase02/`.

The production code rejects the OTP request with 503 until the real F02-C adapter is connected; this follows from the code, not from a tested production deployment. It never falls back to the simulator. There is no record of SMS sending or a hired provider. The sessions issued in the F02-B certification used isolated test accounts and databases. Google keeps the historical Development certification; Testing/production, Facebook and the real SMS adapter remain pending; support and its panel are completed in F03.

## F02-B: accounts and sessions

This section keeps the evolution of F02-B. The paragraphs about `/auth/phone/link-legacy`, passwords and session-less JWTs describe the previous bridge, **removed on 2026-09-13** in the section «Removal of email and password access». They are not part of the current contract.

- `GET /auth/phone/capabilities` declares allowed countries and prefixes, availability and the terms version/text. The current terms are test-only; they do not replace the production legal terms.
- `POST /auth/phone/complete` receives number, receipt, installation UUID, device name and `request_id`. It returns `profile_required` or `authenticated` with user and tokens. A new user completes name and terms; no email is needed and they start as a passenger. Repeating the same operation recovers the same session while the receipt is still valid and its refresh was not used.
- `POST /auth/phone/link-legacy` adds the previous email/password and keeps UUID, role and history. It never merges by historical phone or matching email. A failed password attempt consumes that receipt; passwords of 72 or more UTF-8 bytes require assisted recovery to avoid historical ambiguity from truncation. Linking disables that account's old credentials.
- `POST /auth/refresh` accepts `request_id`, rotates the refresh and records its consumption. A retry with the same ID within 30 seconds recovers the successor without rotating again. Reuse with another ID or outside that window revokes the session and leaves an audit trail. The absolute session expiry is not extended indefinitely.
- `GET /auth/sessions`, `DELETE /auth/sessions/{id}`, `DELETE /auth/sessions/others` and `POST /auth/logout` manage the user's own sessions. JWTs carry `sid` and `jti`; HTTP checks session/account in the database. The WebSocket validates on connect and every five seconds with a new transaction: revocation/expiry closes with 1008 and a validation failure with 1012. The monitor lets the connection cleanup finish on disconnect.
- `POST /auth/phone/change/challenges`, `/change/verify` and `/change` require a session started within the last five minutes and a receipt for the new number tied to the user. Changing it keeps the account, revokes earlier sessions and issues a new one for the current phone. A race with the login of the previous number does not let its former owner recover it.
- `POST /auth/recovery` records a case after verifying a contact number with the `recovery` purpose. It does not assign an account or issue tokens. `ReviewAccountRecovery` requires an operator authorization port, evidence, decision and audit; it deliberately has no public route and grants no privileges to passengers/drivers. The permissions adapter and the panel belong to F03. `/auth/recovery/complete` requires a current approval (24 h) and a new verification; it keeps UUID/role and revokes earlier access. The case code can be copied from the app.

Mobile storage keeps the token pair and the ID of the next refresh in a single encrypted value. It migrates the old keys on renewal, serializes writes, bounds each native wait to five seconds and uses a sign-out marker so old credentials are not restored. Network errors keep the tokens; a confirmed 401 leads to access. Going back, changing the number and retrying discard the responses of abandoned attempts.

Old JWTs without a managed session are accepted temporarily for accounts not yet migrated. That access does not appear as a revocable per-device session; it stops working when linking/changing/recovering the phone. The final removal of the old endpoints and OAuth links belongs to F02-C.

## F02-B evidence

- OTP in Development (2026-09-11): the logs showed 429 responses when repeating requests; no generation 500 errors were observed. The app discarded the challenge when a resend failed. It now keeps the unexpired code, allows verifying it even when the resend has a wait and distinguishes that limit from the verification limit. Without an available challenge, it shows the wait and retries when `Retry-After` expires while the screen stays active. Changing the number or leaving cancels the attempt. It also interprets `retry_after_seconds` when the header is missing. Regression tests: initial limit, failed resend, verification during the wait and cancellation of late responses.
- Walkthrough in Development (2026-09-11): «La solicitud no es válida» was reported after
  login. The passenger stack opened `booking/offers` without `rideId` because it was its
  first declared screen. `(tabs)` is set as the explicit entry; Home
  keeps the recovery of the active ride. Two regression tests reproduced
  the failure before the change and passed after. Mobile suite: **260 passing**,
  TypeScript and lint passing. The user's manual confirmation is still pending;
  the previously downloaded Testing APK requires a new build to
  include this fix.
- Full backend suite: **685 unit/e2e tests passing**; two existing Starlette deprecation warnings. Ruff, OpenAPI and the real-time contract passing.
- HTTP tests: sign-up without email, current terms, fixed role, receipts tied to number/device, idempotent retries, driver migration keeping UUID/role, ambiguous passwords, repeated refresh, device separation, own revocation, number change and recovery with authorization.
- PostgreSQL: eight simultaneous sign-ups create one account/session; different IDs do not reuse a receipt; eight simultaneous refreshes rotate once; changing the number while another login waits does not hand over the previous account. The migration rejects a downgrade that would lose accounts without email.
- Full PostgreSQL suite on a disposable database: **67 passing and 11 skipped**. Eight require POSIX (inherited signals/sockets); three require a test Redis URL. The seeding of the historical migration 0022 test was fixed to use only the columns available in that revision.
- WebSocket: the 34 existing tests passed again after fixing the monitor cleanup. An additional test checks the closing of a live connection after logout and the rejection on reconnect.
- Mobile: 258 tests passing, TypeScript and lint passing. Metro compiled the full Android entry. The 320 px, 200 % text view is prepared in `local-files/phase02/phone-entry-preview.html`; the browser blocked opening it, so no visual or TalkBack review is declared completed.
- Docker image activated in Testing and an EAS archive of 235 mobile files reviewed, excluding backend, `.env` and signing. The user explicitly authorized sending the mobile code, the Android Maps key and the public URL to EAS. No F02-B APK was generated: a working HTTPS address is pending.
- Real test on both local APIs: simulated OTP, pending profile without tokens, sign-up without email as a passenger, idempotent retry, managed session, refresh rotation/retry, revocation of access/refresh on sign-out and rejection of cross tokens. Report: `local-files/phase02/live-phone-verification-local.json`.
- Live compatibility: login of the existing driver and reception of the snapshot over WebSocket passed on both local services; the APIs stayed ready after disconnecting. Report: `local-files/phase02/local-websocket-verification.json`.
- Docker was recovered by renaming two directories that only contained empty, inaccessible temporary sockets. Volumes and images stayed intact. The two temporary Cloudflare domains tested returned NXDOMAIN, even when querying public/authoritative DNS; the public HTTPS/WS certification is not declared completed. Free ngrok with a stable assigned domain was proposed, subject to the user's account.

Current phone guide and operational status: `local-files/phase02/f02b-phone-checklist.md`. The verification logs stay in `local-files/phase02/`; the previous paragraphs about Cloudflare document the situation before recovering ngrok.

## F02-C: social access and linking

- `GET /auth/phone/capabilities` adds `social_providers`. It only announces providers with server configuration; older clients ignore the field and new ones tolerate servers without it.
- `POST /auth/social/{provider}/sign-in` verifies the provider token and receives the installation/device name. It returns `phone_required` without creating an account or session if the link with a verified phone is still missing. An already linked identity receives a managed, revocable session.
- The app asks for number and OTP, shows an explicit confirmation and calls `POST /auth/phone/link-social`. Both receipts are verified before linking. New users complete name and terms; earlier accounts are looked up exclusively by provider/identifier, keeping UUID, data and role. The provider's email does not merge accounts.
- Linking, consuming the OTP and issuing the session share a transaction. The PostgreSQL lock follows the order social identity → phone → account; the existing uniqueness prevents moving an identity or silently replacing another one from the same provider. Repeating the receipt and `request_id` recovers the result. A social identity does not change an already verified phone to another number.
- `/auth/oauth/{provider}` was a temporary bridge for historical social accounts; it was removed on 2026-09-13 together with all email access (see «Removal of email access»).
- Google uses the native SDK and an ID token whose audience is the server's web client. Certificate verification runs outside the event loop and with a bounded wait. Facebook Android uses the native SDK; the backend validates the app, USER type, validity and the equality of the subject between `debug_token` and `me`, without requiring email. Graph API v26.0; tokens are not logged through the HTTPX URL log.
- The native SDKs are loaded on use; an earlier APK keeps phone access and leaves the social buttons disabled. Facebook is not initialized when the app opens and does not log events/advertising automatically. Facebook on iOS stays disabled until Limited Login with a nonce is implemented and verified. The web keeps AuthSession; its walkthrough with real providers was not certified.

Manual evidence of 2026-09-13 (Development): `GET /auth/phone/capabilities` announces `social_providers: ["google"]`; the full walkthrough recorded `POST /auth/social/google/sign-in` 200 → `POST /auth/phone/challenges` 201 → `POST /auth/phone/verify` 200 → `POST /auth/phone/link-social` 200, first on the `viajaya_pasajero` emulator and then on a Xiaomi phone with the same dev build (`com.viajaya.app.dev`, debug keystore), where the already linked identity reused the account. The consent screen is still in *Testing* mode: only registered test users can sign in; publishing it (basic scopes, without Google verification) opens access to any account. The Development LAN IP changed to `192.168.1.57`. No code changes in this certification.

Automated evidence of the previous continuation: **701 backend and 275 mobile tests passing**, Ruff, TypeScript, lint, OpenAPI and generated types passing. **7 PostgreSQL tests passing** on a freshly created database dropped at the end, including eight simultaneous idempotent linkings and two phones competing for one identity. Android generation verified in isolated copies for Development, Testing and Production, with missing providers and with synthetic configuration. The full bundle served by Metro includes the OTP wait/retry, the social confirmation and native SDK detection; both APIs and Testing HTTPS returned 200 at the end. These checks do not certify a signed APK or a real login with Google/Facebook. Testing keeps its F02-B image/API until the new code is deployed. Configuration guide and limits: [social access](../social-access-setup.md).

## Removal of email and password access (2026-09-13)

The user's decision, before production and without real users: email access was removed
completely instead of keeping the migration bridge.

- Backend: `POST /auth/register`, `/auth/login`, `/auth/oauth/{provider}` and `/auth/phone/link-legacy`
  no longer exist (404); `RegisterUser`, `AuthenticateUser`, `AuthenticateWithOAuth`,
  the legacy `RefreshToken`, `PasswordHasher`/bcrypt, `RawPassword`, `token_issuer` and `authenticate_ws` were deleted.
  Migration `0026_drop_password_access` removes `users.hashed_password` and
  `users.legacy_auth_disabled`. A JWT without `session_id` gets 401 on `/me`, `/refresh` and WS.
  `CompletePhoneSignIn` keeps only the phone and phone+social paths. No `bcrypt` in
  the dependencies.
- Seed and smokes: `scripts/seed.py` creates accounts with a verified phone (`+59170000001/2`,
  `+59170000011/12`, `+59170000021/22`); `scripts/phone_access.py` authenticates the smokes via
  simulated OTP; `smoke_environment_image.py` validates the image through the same flow.
- Tests: `tests/e2e/helpers.py` (`sign_in`, `sign_in_sync`, `promote_to_driver`, `test_settings`)
  replaces `/auth/register` across the suite; `conftest.py` no longer depends on `.env`. The
  PostgreSQL certification purges test accounts before going below `0025`.
- Mobile: routes `(auth)/login` and `(auth)/register` → a single `(auth)` route with `PhoneEntryScreen`;
  removed `LoginScreen`, `RegisterScreen`, `useAuth` (`useLogin`/`useRegister`), `validation.ts`,
  `SocialButton`, `Checkbox`, `Divider`, the controller's `legacy` mode and the
  `register/login/oauth` methods of `authRepository`; `authStore` keeps `bootstrap`, `acceptPhoneSession`
  and `signOut`. Dependencies `react-hook-form` and `@hookform/resolvers` removed.
- Evidence: backend 685 fast tests + 72 PostgreSQL passing, ruff clean; mobile 274
  tests, tsc and lint passing; OpenAPI and types regenerated. On the emulator (Development): the
  previous Google session survived the migration, `Cerrar sesión` led to the single access
  screen (without «Ya tenía una cuenta con correo») and `+59170000001` signed in with simulated OTP as an
  existing account without asking for a profile.

## Earlier F02-A evidence

- Backend suite: **671 unit/e2e tests passing**. A first run had 36 errors creating Windows temp files; those 36 were repeated in a new project directory and passed. The existing opt-in suites stay separate from the Development/Testing data.
- New HTTP tests: **22 cases**, including lower environments without external transport, expiry, reuse, limits, binding to phone/device/purpose, receipt rollback and a production contract without test codes.
- Disposable PostgreSQL: reversible migration keeping account/role, identity uniqueness and races between eight requests, eight verifications and eight consumptions. Waiting on a lock does not extend the code's validity.
- Mobile: **249 tests passing**, with 14 new controller and HTTP contract cases; TypeScript and lint passing.
- Metro compiled the real form for Android. This checks resolution and compilation; its visual walkthrough on a phone will be certified when wiring the route in F02-B.
- Ruff passing. OpenAPI and mobile types updated together. The operational scripts and artifacts live in `local-files/phase02/`.
