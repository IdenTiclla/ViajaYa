# F01 — Technical foundation and three environments

Initial date: 2026-09-09. Status update: 2026-09-19. Original branch: `codex/phase-01-environments`; merged into `main` through PR #15 (`986dd79`, 2026-09-14).

Status: **F01 completed and verified locally**, with historical evidence of Development and Testing APKs built and signed on EAS. Testing was temporarily configured on this PC with HTTPS; its current availability and permanent hosting were not certified in the 2026-09-19 review. F02 already has an implementation and keeps pending closures. Current status: [production plan](../plans/production-launch-plan.md).

## Deliveries

- [x] F01-A: `APP_ENV=development|testing|production` contract, validated configuration, examples and protection against wrong provider modes.
- [x] F01-B: separate Android/iOS identities and links, public variables per environment, validated runtime configuration and a badge in lower environments.
- [x] F01-C: `uv.lock`, portable time zones, pinned Dockerfile, separate migration process, deployment definition and extended CI.
- [x] Persistent preference: new code/identifiers/comments in English, UI and user-facing documentation in Spanish; verify every implementation. (Superseded on 2026-09-24: repository documentation is also in English.)

## Decisions

- Testing is technically identified as `testing`; EAS keeps its `preview` profile/environment. Its app uses `com.viajaya.app.testing`.
- New tokens require a specific issuer and audience. Earlier tokens without those fields require signing in again; the account and history are kept.
- Issuer/audience keys, Redis and storage are validated per environment; the separate physical resources are provisioned/certified in F09.
- The server and the mobile build reject test OTP in production. Challenges and the autofill screen belong to F02; they are not presented as implemented here.
- The mobile bundle contains only public configuration. OTA stays disabled until its delivery mechanism is certified in F09.
- Local verification uses `.venv-f01` and disposable containers, without replacing the existing backend virtual environment or restarting its containers.

## Evidence

- Backend: **649 tests passing**, including configuration, JWT and the HTTP boundary between environments. The **69 opt-in tests of the full PostgreSQL/Redis suite were skipped** in this run; that destructive suite was not pointed at the development database. The image smoke did verify migrations and authentication against a new, disposable PostgreSQL.
- Mobile: **235 tests passing**, including 19 for configuration and the HTTP client's environment header; TypeScript and lint passing.
- Expo generated the three configurations and isolated Android projects; the native `applicationId`, scheme and name were checked.
- Runtime and test images built with pinned dependencies.
- Runtime smoke: PostgreSQL migrations, readiness, registration, refresh and authentication passed; a token from another environment rejected; insecure production configuration rejected; running with UID 10001 and without `.env` in the image.
- The two hosted Compose definitions pass validation without deploying services.
- Ruff, OpenAPI/realtime snapshots and the generated TypeScript DTO: passing. LF was pinned in the generated file to avoid false negatives between Windows and Linux.
- Production Android bundle compiled with Hermes: 2,059 modules, output under `local-files/phase01/android-production-bundle/`. Synthetic values were used and `.env` loading was disabled.
- Workflow reviewed with actionlint: no errors. The branch is already merged; linking and checking the remote CI result of the candidate to be certified is still missing.
- OpenAPI tools: three transitive dependencies updated within compatible ranges; `npm audit` of the root tools finished with zero vulnerabilities. This figure does not represent an audit of all mobile/backend dependencies.

### Android installation and temporary Testing — 2026-09-09

- EAS finished the Development build `93c514f6-e85b-44ff-a189-6bf27406fea2` and the Testing build `bf2dd2df-c20a-4859-a61e-a449090778ae`. The uploaded archive was reviewed: 220 mobile files, without backend, `.env`, signing credentials or local artifacts; `.easignore` limits the uploaded content.
- The two downloaded APKs pass ZIP integrity, cryptographic verification with `apksigner` and a check of native identity, scheme, environment and API. Testing includes its JavaScript bundle and does not depend on Metro. Local evidence: `local-files/phase01/development-apk-verification.json` and `testing-apk-verification.json`.
- The user installed **ViajaYa Desarrollo** and confirmed it reaches the login. Metro is reachable on the LAN. This does not yet certify a full ride or Maps/OAuth working on the phone.
- Testing uses the Docker project `viajaya-testing-local`, with separate PostgreSQL, Redis, fictitious users and JWT secret. The API listens on `127.0.0.1:8001` and is exposed through a temporary HTTPS tunnel authorized by the user.
- Real verification of Testing over HTTPS: readiness, login, profile, refresh and WebSocket passed; a wrong environment header rejected and a Testing token rejected in Development. Development is still healthy. Evidence: `local-files/phase01/testing/verification-report.json`.
- APKs, links, QR codes and the installation guide saved in `local-files/phase01/`. The user also installed **ViajaYa Pruebas** and confirmed the login appears with the **Pruebas** badge. Checking access with accounts and a full ride from the phones is still pending.

## External conditions and next phase

There is no certified permanent hosting for testing/production nor real SMS delivery. The temporary Testing server requires keeping this PC, Docker and the tunnel running. In F02, HTTPS was recovered with ngrok; if the URL embedded in the binary changes, it has to be rebuilt. It does not replace the deployment and operations planned in F09.

The existing public mobile Maps key was explicitly configured as a Testing variable in EAS. Separating Google credentials per environment and certifying package/signature restrictions is still pending. Full functional certification on phones, the production binary, iOS and store publication are also pending.

The local history confirms the merge of PR #15 into `main` on 2026-09-14. GitHub Actions was not queried in the 2026-09-19 review; an approved remote CI is not inferred from the merge.

Next closure: complete F02 certification and its SMS adapter; F03-A can move forward as independent work. Operational guide: `docs/environments.md`.
