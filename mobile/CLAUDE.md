@AGENTS.md

# ViajaYa — Mobile (Expo + React Native + TypeScript)

Taxi and parcel app. Expo Router (file-based, typed routes), React Query (server state),
Zustand (auth/client), axios, react-native-maps, phone + OTP access with Google/Facebook
linked to a verified phone (no email/password), real time over WebSocket.

Stack: **Expo ~56.0.7** · React Native 0.85.3 · React 19 · TypeScript ~6.0.3 ·
`expo-router ~56.2.8` · `zustand ^5` · `@tanstack/react-query ^5` · `axios ^1.16` ·
`react-native-maps 1.27` · `zod ^4` (WS schemas).

> ⚠️ **Expo 56 changed a lot.** ALWAYS read the versioned docs before writing code:
> https://docs.expo.dev/versions/v56.0.0/ (see `AGENTS.md`).

## Architecture

Code organized by **features**, each one in layers (Clean Architecture adapted to the client).
Routing (`src/app/`) only mounts screens; logic lives in `src/features/`.

```
src/
├── app/                 # Routes (expo-router, file-based). Screen composition only.
│   ├── _layout.tsx        # Root: providers (theme, QueryClient, SafeArea, GestureHandler) + session/role gate
│   ├── index.tsx          # Redirect by role → (auth) | (app)/(tabs) | (driver)/(tabs)/requests
│   ├── (auth)/            # index → PhoneEntryScreen: the only access view (phone + OTP, Google).
│   │                      # A new number completes name + terms right there. No email/password
│   ├── (app)/             # Passenger group (guard: authenticated && !driver)
│   │   ├── _layout.tsx      # Mounts <PassengerToaster/> over the stack
│   │   ├── (tabs)/          # Trip · History · Wallet · Profile  (PillTabBar)
│   │   ├── booking/         # destination, configure, offers, trip, rating,
│   │   │                    #   pick-on-map, saved-places, edit-place
│   │   └── driver/register.tsx  # create/edit a vehicle (?vehicle=taxi|moto|truck) from Profile
│   ├── choose-mode.tsx    # after sign-in an approved driver picks mode and vehicle
│   └── (driver)/          # Driver group (guard: role === 'driver')
│       ├── _layout.tsx      # Mounts useDriverPoolSocket() + <DriverToaster/>
│       ├── offer-sent.tsx
│       └── (tabs)/          # Requests · History · Earnings · Profile  (PillTabBar)
│                            #   (index hidden via tabBarButton: () => null → redirect to Requests)
├── features/            # One folder per feature, in layers (Clean Architecture).
│   ├── auth/              # domain/ (types + vehicleCatalog: VEHICLE_META, SERVICES_FOR_VEHICLE) · data/
│   │                      #   · application/ (phoneAccessController + useAuthController)
│   │                      # presentation/: PhoneEntryScreen · PhoneCodeForm · AccountSecurityPanel
│   │                      #   entry/ = blocks of the access view (AuthScaffold, PhoneInput, SocialButtons, TermsCheckbox…)
│   ├── booking/           # 4 full layers (booking flow)
│   ├── home/              # domain/ (orientation) · data/ · application/ · presentation/
│   ├── rides/             # offers + ride lifecycle + passenger and driver WS hooks
│   │   ├── domain/          # types.ts · fareInput.ts · geo.ts · offerTags.ts
│   │   ├── data/            # ridesRepository.ts (DTO ↔ domain)
│   │   ├── application/     # useRides · useRideMutations · useCloseFlow · useNegotiationSocket
│   │   └── presentation/    # FareKeypad · OfferLifeTimer · RideHistoryScreen · RideRatingCard · …
│   ├── profile/           # passenger profile presentation and shared theme selector
│   └── driver/            # reuses rides data/domain for the pool; own data/ only for the account
│       ├── domain/          # DriverVehicle (up to one per type; MAX_DRIVER_VEHICLES)
│       ├── data/            # driverAccountRepository (/drivers/me/vehicles · /me/mode)
│       ├── application/     # useDriverRequests (zustand) · useDriverToasts · useDriverAccount
│       └── presentation/    # IncomingRequestsScreen · DriverTopBar · RequestCard · DriverSearchMap
│                            #   · DriverRegistrationScreen · DriverAccountCard · VehicleSelector
│                            #   · ChooseModeScreen · DriverProfileScreen · …
├── core/               # Cross-cutting infrastructure
│   ├── components/       # PillTabBar (Stitch bottom bar: active tab with a yellow pill)
│   ├── config/env.ts     # Typed config from Constants.expoConfig.extra
│   ├── http/             # client.ts (axios + token/refresh interceptors), tokenStorage (SecureStore)
│   ├── realtime/socket.ts # Generic WS with reconnect (token via subprotocol, exponential backoff)
│   ├── errors/apiError.ts
│   ├── hooks/            # useCountdown (AppState-aware), …
│   └── theme/            # palettes, reactive styles and persisted local preference
├── shared/components/  # Reusable UI: Button, TextField, ConfirmDialog, FeedbackState, map/, …
└── store/authStore.ts  # Global session (zustand): bootstrap/`acceptPhoneSession`/signOut; auto-logout if refresh fails
```

### Rules when adding code

- **Respect the feature layers.** Screens (`presentation/`) consume hooks (`application/`),
  which call repos/services (`data/`), which map to `domain/` types. Do not `fetch`/axios from a component.
- **All HTTP IO goes through `src/core/http/client.ts`** (the `api` instance). It already attaches the Bearer token
  and refreshes on 401 (deduplicating concurrent refreshes). Do not create loose axios instances or use `fetch`.
- **Real time: WS is the primary path; React Query polling is only a slow fallback.**
  The WS mutates the React Query cache live (via `queryClient.setQueryData`). The token travels
  as the `viajaya.auth` subprotocol, outside the URL and access logs.
- **Config only from `@/core/config/env`.** Never read `process.env` at runtime; keys are exposed
  via `app.config.ts` → `extra` → `env`. Edit `.env` (see `.env.example`) for local values.
- **Reuse `shared/components/`** before creating new UI; respect the `theme/tokens`.
- **Import aliases:** `@/*` → `src/*`, `@/assets/*` → `assets/*`. `experiments.typedRoutes: true`
  in `app.config.ts` → `href`s of `<Redirect>`/`navigate` are typed.
- **New screens:** create the route file in `src/app/...` (1–5 lines) and delegate to a
  `presentation/` component.

## Routing by role

`src/app/_layout.tsx` uses `<Stack.Protected guard=...>` with 3 mutually exclusive guards:
`(app)` (auth && !driver), `(driver)` (driver), `(auth)` (!auth). `src/app/index.tsx` redirects:

- not authenticated → `/(auth)` (`PhoneEntryScreen`: the only access screen, with no separate sign-up or
  recovery). A new number goes through `ProfileCompletionForm` (name + terms) after the OTP.
  The controller (`useAuthController()`) keeps the recovery flow even though it has no UI today.
- passenger → `/(app)/(tabs)` (initial tab: Trip)
- driver → `/(driver)/(tabs)/requests` (lands directly on Requests, not on Home)

**One account, two modes, up to three vehicles.** `user.role` is the active mode returned by the
backend. In Profile (passenger) `DriverAccountCard` lists the vehicles (`useDriverVehicles`,
key `['driver-vehicles']`) with their status and allows adding/editing/removing
(`DriverRegistrationScreen`, `?vehicle=` edits that type; when adding only the free types
are offered). With approved vehicles, `VehicleSelector` shows "Conducir con Taxi · placa" for each
one; choosing calls `useSwitchAccountMode({mode:'driver', vehicleType})` (`POST /drivers/me/mode`),
which, if the user is online, first takes them offline, clears React Query (`removeQueries`),
replaces `user` (`setUser`) and does `router.replace('/')` so the guards reroute. In driver
mode, Profile allows switching vehicle (other approved ones) and going back to passenger.

**On sign-in** with an account that has an approved vehicle, `authStore.modeChoicePending`
becomes `true` and `index.tsx` redirects to `/choose-mode` (`ChooseModeScreen`: "Pedir viajes" or
"Conducir con …" per vehicle). Startup with a stored session (`bootstrap`) does not ask
again. Do not duplicate that flow: the existing role-based navigation does the rest.

**Stitch bottom bar** (`core/components/PillTabBar.tsx`, shared by passenger and driver):
the active icon has a yellow background pill (`colors.accent` = `#F5C518`).
All labels stay below their icon; with large text they spread
over two rows to keep the full text.
Hidden routes declare `tabBarButton: () => null` (e.g. the driver's `index` redirect).
The driver uses it through `features/driver/presentation/DriverTabBar`, which hides the bar
during the ride flow (active ride or pending rating) and returns the driver to Requests,
where that flow is rendered. The passenger's `TripScreen` redirects straight to
`booking/rating` once the ride is `completed` (no intermediate "Calificar" step).

## State management

- **Server state → React Query** (`QueryClient` singleton: `retry:1`, `staleTime:30s`). Slow polling
  (15–20 s) as a WS fallback in `useOpenRides`, `useRideOffers`, `useRide`, `useDriverActiveRide`.
- Ride `queryFn`s propagate `signal` down to Axios. Keep that chain when
  adding queries so that `cancelQueries` also cancels the HTTP transport.
- The open pool and history use `useInfiniteQuery` over the
  `{items, next_cursor}` contract. The `['open-rides']` cache is `InfiniteData`: WS
  events must use `features/rides/application/openRidesCache.ts`, not write arrays
  directly.
- **Session/client state → Zustand**: `authStore` (session), `useBookingStore` (booking),
  `useDriverRequests` (driver sets `dismissed`/`offered`/`rejected`/`taken`/`expired`/`paused`),
  `usePassengerToasts` / `useDriverToasts` (ephemeral toasts, max 3).
- **Query keys** (array convention): `['open-rides']`, `['ride-offers', rideId]`,
  `['ride', rideId]`, `['driver-active-ride']`, `['ride-history', status|'all']`, `['driver-earnings']`.
- **Do not duplicate server state in stores.**

### Main hooks

- `features/rides/application/useRides.ts` — `useOpenRides`, `useRideOffers`, `useRide`, `useDriverActiveRide`.
- `features/rides/application/useRideMutations.ts` — `useCreateOffer`, `useAcceptOffer`, `useRejectOffer`,
  `useWithdrawOffer`, `useUpdateRideStatus`, `useCancelRide`, `useUpdateRideFare`, `useSetOnline`,
  `usePauseForEdit`, `useEditRide`.
- `features/rides/application/useCloseFlow.ts` — `useRideHistory`, `useDriverEarnings`, `useRateRide`.
- `features/rides/application/useNegotiationSocket.ts` — `useNegotiationSocket(rideId)` (passenger) and
  **`useDriverPoolSocket()`** (driver). Both in the SAME file; the driver's is mounted only
  once in `(driver)/_layout.tsx` (single channel).
- `features/driver/application/useDriverRequests.ts` — driver store + `useAutoExpireOffers()`
  (self-heals expired offers without a WS event: 1 s tick).

## WebSockets on the client

Infra: `core/realtime/socket.ts` — `openSocket(path, onMessage)`. Exponential backoff (1 s→5 s),
replaces suspended sockets when returning to foreground (`AppState`) and processes messages in order.
**Downstream only**: parses `{type,data}` and passes it to the callback.

The hooks use dual legacy/v2 parsers. Each connection must first complete
its snapshot and cannot mix protocols: a gap, conflict, invalid frame or
handler failure discards the socket generation and forces another handshake without
losing the already confirmed cursors. The v2 gate confirms each ticket only after
updating React Query/Zustand; duplicates and old positions neither mutate nor
repeat notices.
In a dev build, `core/realtime/diagnostics.ts` keeps a bounded buffer and
emits `[realtime]` logs with connection, snapshot, close code, discard
cause and resync. Do not add routes, IDs, tokens, frames or payloads to that
contract; it stays disabled outside `__DEV__`.
During the correlation rollout, `correlation_id` may be missing in a v2 event
from the previous backend; mobile then uses `batch_id`. Correlation is diagnostic
metadata and does not change the idempotent identity of an `event_id`.

Events the hooks listen to (WS → React Query cache mutation + Zustand state + toast):

- **Passenger** (`/ws/rides/{rideId}`): `offers_snapshot`, `offer_created`, `offer_withdrawn`
  (except `reason==='superseded'`), `offer_expired`, `ride_status`.
- **Driver** (`/ws/driver`): the required streams of the v2 snapshot are `driver:{id}` plus
  one `pool:{service}` per `user.driverServices` (not a fixed "vehicle + delivery").
  `open_rides_snapshot`, `driver_offers_snapshot` (rehydrates
  pending offers after a restart), `ride_created`, `ride_closed`, `ride_paused`,
  `offer_accepted`, `offer_expired`, `offer_rejected` (`ride_taken`/`ride_cancelled`/`declined`),
  `offers_withdrawn`, `ride_status`, `driver_active_ride` (snapshot on reconnect).

`ride_status` reducers are monotonic and cross-check detail + active ride;
the same status does refresh the payload. `offer_expired` applies by exact
`offer_id` and only notifies if it withdrew the current offer. `offers_withdrawn`
removes by the exact `{ride_id, offer_id}` pairs when present, so that a
late summary does not delete a re-offer; `ride_ids` is kept as a legacy
fallback. A successful HTTP switch to offline also clears the live offers to
tolerate a WebSocket drop.

The driver store keeps bounded tombstones by `offer_id`, terminal
rides, pool generations and a token per HTTP attempt. `markOffered` is
a CAS: the late `201`
of a rejected, expired, paused, accepted, taken, cancelled or withdrawn offer
cannot revive it, nor can an earlier response beat another request. Duplicate or late
`ride_created` events do not clear outcomes of another generation.
`ride_closed` carries `pool_version` and `reason=paused|terminal`: only an
applicable close removes the card and the visible offer, and a terminal one dominates a pause
of the same generation. A PostgreSQL `PENDING` snapshot does correct contradictory local
guards, including an expiry from a clock running ahead.

The passenger v2 snapshot replaces detail, active ride and offers under a single
`ride:*` watermark. The driver's replaces open pool, paused, offers and
`active_ride` (also when it is `null`) with the watermarks of their vehicle,
delivery and `driver:*`. To arbitrate a concurrent `201`, dates are not compared:
PostgreSQL does not order commits with `now()`. The store records which local attempts
were already in flight when the snapshot was applied; if a missing one resolves later,
it forces another handshake that authoritatively decides whether it is still `PENDING`.

## Theme (design system)

`core/theme/tokens.ts` contains the light and dark palettes and the design tokens.
The app starts in **light**, regardless of the system. **Perfil → Apariencia**
lets the user choose Light or Dark for passenger and driver. The preference lives in
`viajaya.tema` (native SecureStore; web localStorage), is kept on sign-out
and does not modify the backend account.

`AppThemeProvider` syncs colors, Expo Router, StatusBar, Appearance and the native
background. Changing the theme updates the context without remounting screens or losing
forms or connections. `createThemeStore` bounds the read to 5 s, discards results
older than a choice and allows retrying if storage fails.

Light palette:

- `colors.primary #16308C` (TaxiGo blue) · `colors.primaryDark #0F2266` · `colors.accent #F5C518`
  (Stitch yellow: active tab, stars, accents) · `brand #16308C` + `textOnBrand #FFFFFF`
  (fixed in both themes: the name «Viaja» in white + «Ya» in `accent` over blue, like the logo and splash;
  used by the Home header and `LaunchScreen`) · `success #167347` · `danger #C52C22` ·
  `text #182230` · `textSecondary #536174` · `surfaceMuted #F3F5F8` · `border #DCE2EB`.
- `controlBorder #7D8796` identifies fields and options; `border` is reserved for
  decorative separators. `primarySoft` and `dangerSoft` go with secondary
  actions with dark text; disabled states use explicit colors.
- `spacing` xs/sm/md/lg/xl/xxl = 4/8/16/24/32/48 · `radius` sm/md/lg/pill = 8/12/16/999 ·
  `fontSize` xs…xxl = 12/14/16/20/24/32 · `fontWeight` regular/medium/semibold/bold.

Dark palette: background `#10151F`, cards `#192230`, text `#F3F6FC`, primary
`#A8BDFF` and text on primary `#10204E`. Both themes keep contrast for
text, controls and states. `app.config.ts` keeps `userInterfaceStyle: 'light'`
as the native base; Appearance then applies the app's explicit choice.

Import size tokens and hooks from `@/core/theme`. Inside the component,
use `useTheme()` for loose colors or `useThemedStyles(createStyles)` to get
`{ colors, styles, focusStyle }`. Declare the factory outside the component:

```tsx
const createStyles = ({ colors }: Theme) => StyleSheet.create({
  card: { backgroundColor: colors.surface, padding: spacing.md },
});
```

Do not capture colors in `StyleSheet.create` or module-level icon tables.
Maps use `useMapStyle` and an explicit `userInterfaceStyle`; changing the theme must
also redraw the native markers. Use `textOnAccent` on yellow.
Splash/adaptiveIcon keep the brand blue `#16308C`. Logo ("F2", 2026-09-23): «Viaja» white +
«Ya» yellow over a taxi and a mototaxi in profile. `icon.png` (iOS), `android-icon-foreground/
monochrome` (inside the 66 dp safe circle) and `splash-icon.png` (`imageWidth: 200`) use it;
changing them requires prebuild + rebuilding the APK. After the native splash, `core/components/LaunchScreen`
shows `launch-screen.png` (yellow route with taxi and mototaxi, name and slogan «Taxi o moto, tú pones
el precio.») while `bootstrap` restores the session, with a minimum of 1.2 s (`LAUNCH_MIN_MS`), only on
cold start; login, logout and Reintentar show the lightweight spinner.

### Controls and accessibility

- Icons use `@react-native-vector-icons/ionicons` and
  `@react-native-vector-icons/fontawesome`, with per-family imports. Dynamic
  loading through `expo-font` is kept: fonts travel as Metro assets.
  `expo.autolinking.exclude` in `package.json` excludes both families to avoid
  also copying them into the native binary. Do not add `/static` imports, plugins for these
  families or manual fonts without reviewing that configuration together.
- Custom map symbols live in `shared/components/map/`: circular A
  for origin, circular B for destination and top-down taxi/moto vehicles. They are drawn
  with native views and tokens, without icon fonts. The A/B letter has a
  fixed scale because it is part of the symbol; the label and accessible name keep
  the meaning. The selection pin anchors the stem tip at 50% of the map,
  without estimating the text height. `VehicleMarker` (32 dp, no background disc; the vehicle measures ~14×24 dp to fit in the street) belongs to the native map:
  GPS coordinates, `flat` and center anchor; rotation follows geographic north
  even when the camera turns. The radar sweep is decorative only. GPS
  requests updates every second; a reliable movement heading has
  priority and, when stopped, the calibrated compass is used. A single
  subscription is kept while the search tab is focused; Expo handles the
  native pause in the background. Returning to the app checks permissions and services
  without opening dialogs or recreating a healthy watcher. Losing focus cancels even
  a pending sign-up. A one-off acquisition with balanced accuracy allows
  the first centering while precise GPS arrives; it is shared if there are retries.
  The map is mounted only when recent coordinates are received, without a fixed fallback
  city; loading has 15 s before offering Reintentar and a late signal
  recovers the map. The camera measures the container and waits for `onMapReady`; the first
  centering and tracking use `setCamera`, with gestures locked. The radar lives
  inside `DriverSearchMap` and takes the GPS projection from `pointForCoordinate`;
  it discards late responses and hides if the projection fails. See plan 0020.
- Reuse `Button` for form and screen-footer actions: minimum height
  of 48, 14 text and natural growth when enlarging the font. Avoid fixed
  heights and `adjustsFontSizeToFit` to make action labels fit.
- Reserve `primary` for the main action, `secondary` for alternatives,
  `dangerSoft` for starting a destructive action and `danger` for confirming it.
  Buttons and fields use radius 16; `secondary` has a `surface` background and a
  `controlBorder` border. Pressed, disabled and loading states keep their size.
  In tracking/negotiation, `TripSecondaryAction` uses the `text` variant of
  `Button` to keep cancel or skip in the background; cancelling still
  requires a destructive dialog. Keep the minimum 48 touch target.
  `loading` blocks the action and reports its state; `accessibilityState.busy` can
  communicate a background query that still allows interaction.
- Keep visible keyboard focus (`focusStyle`) and selection,
  loading and disabled states also via `aria-*`, compatible with React Native
  and React Native Web. Selection is also distinguished by a visible mark.
- Fields keep labels while typing and associate errors through their
  accessibility hint. `TextField` supports `helperText` (the error has priority)
  and `showCharacterCount` for controlled values with `maxLength`.
  Dialogs anchor the card at the bottom on mobile, scroll only the content and
  keep their actions visible; on open they focus the title for the native
  screen reader. On wide screens they are centered and use horizontal actions.
  `PersonAvatar` unifies decorative initials; it must be accompanied by the full
  accessible name. `FeedbackState` blocks retrying while loading.
- Verify controls with 200% text and narrow screens. A
  web preview helps check geometry and keyboard; TalkBack and
  VoiceOver require on-device validation.
- Search keeps access to the map while loading, on error and with no results.
  `useDestinationSelection` invalidates earlier resolutions when the search changes,
  another destination is chosen or the screen is left; a failure loading recents is not an empty list.
- Offers separate price, estimated arrival and expiry, keeping full names
  and vehicles. Rating allows skipping even after choosing stars;
  while sending or skipping, its controls stay locked.

## HTTP client

`core/http/client.ts`: instance `api = axios.create({ baseURL: env.apiUrl, timeout: 15000 })`.

- **Request interceptor**: attaches `Authorization: Bearer <accessToken>` from `tokenStorage`.
- **Response interceptor**: on 401 (if the URL is not in `NO_REFRESH_PATHS` and is not `_retry`),
  triggers a **shared** `refreshAccessToken()` (concurrency dedupe) → `POST /auth/refresh` →
  stores the new pair → retries the original. A refresh rejected with 401
  (or without credentials), or a second 401 with the renewed token, runs
  `tokenStorage.clear()` + `onSessionExpired()`;
  network, timeout and 5xx keep the session so it can retry. The shared refresh
  is always released in `finally`, even if SecureStore fails.
- `env.apiUrl` comes from `app.config.ts` → `extra.apiUrl`; `env.wsUrl` is derived with `toWsUrl()`.
- Tokens in `expo-secure-store`, atomic value `viajaya.session.v2` with `refreshRequestId`; the old keys `viajaya.accessToken`/`viajaya.refreshToken` are read for migration. Writes are serialized, have a bounded wait, and sign-out leaves a marker to prevent old keys from restoring the session. Never use plain AsyncStorage for credentials.
- The refresh also goes through `api` with `skipAuth: true` and the 15 s timeout;
  a session renewal must never be left without a wait limit.
- Home checks the active ride and then the rating with a total limit of 30 s in
  `features/home/application/confirmRecovery.ts`. A failure or timeout shows
  Reintentar before the loading indicator; retrying repeats the whole
  check. A late response does not authorize navigation after the timeout.
- Reading SecureStore has a 5 s limit. The full startup has 30 s and
  shows `SessionRecoveryScreen` with Reintentar if it fails; it keeps credentials
  on transient errors. It also offers Volver a iniciar sesión: the native
  deletion has a 5 s limit and its failure does not block login. Access
  endpoints use `skipAuth` so they do not depend on earlier credentials. A generation
  discards startup responses and renewals older than
  leaving, starting another session or the current one expiring.
- Confirming/skipping a rating waits for local cancellations to settle
  before removing that closure from the active/pending caches. It does not
  cancel them again when navigating: `CancelledError` must not restore the
  recovery screen. Later invalidations run in the background; no other
  network response is awaited. Other pending ones are kept.
- Recovery screens prioritize errors over other queries' loading.
  A background update does not replace an already verified screen with a spinner.
  Without ride detail, Trip, Rating and Edit allow going back
  home; an inaccessible request also allows leaving Offers. That exit
  does not cancel rides: Home queries the authoritative state again.

## Backend contract

API under `/api/v1`. Data layer pattern (canonical: `features/rides/data/ridesRepository.ts`):

1. Import `api` from `@/core/http/client` and types from `domain/types.ts`.
2. Define DTO types matching the backend contract (**snake_case**: `service_type`, `fare`
   as a decimal string, `eta_min`, `full_name`, `accepted_price`, …).
3. `toX(dto): Domain` functions (parse with `Number.parseFloat`, rename to camelCase).
4. Export a `ridesRepository = { … }` object with the `api.get/post/patch` methods.

**Two `ridesRepository`s**: `features/booking/data/ridesRepository.ts` (creates the request `POST /rides`)
and `features/rides/data/ridesRepository.ts` (offers + lifecycle). Intentional split by feature.

**When an endpoint or schema changes in the backend, update the mobile DTO/repository/type
here.** Keep both sides in sync.

### Domain enums (mobile)

`ServiceType = 'taxi' | 'moto' | 'delivery' | 'moving'` · `VehicleType = 'taxi' | 'moto' | 'truck'`
(truck; only serves `moving`) · `DriverStatus = 'pending' | 'approved' | 'rejected'` ·
`PaymentMethod = 'qr' | 'cash'` ·
`RideStatus = 'searching' | 'accepted' | 'arriving' | 'in_progress' | 'completed' | 'cancelled'` ·
`OfferStatus = 'pending' | 'accepted' | 'rejected' | 'expired'`. Offer TTL = 30 s. Currency = Bs (bolivianos).

## Commands

```bash
cd mobile
npm install
cp .env.example .env       # API_URL (backend LAN IP), Maps/OAuth keys

# Dev: DEV BUILD flow (NOT Expo Go). There is a pregenerated android/, eas.json and expo-dev-client.
npx expo start             # Metro dev server
npm run android            # expo run:android  (dev client on emulator/device)
npm run ios                # expo run:ios

# Quality (run before committing)
npx tsc --noEmit           # strict type-check
npm run lint               # expo lint (eslint-config-expo)
```

> **Android emulator:** run it with the **dev-client** (not Expo Go). It requires the Android toolchain
> and an AVD; see `~/.local` and `~/Android` on the development machine.

## Conventions

- **Strict TypeScript** (`strict: true`); avoid `any`, type API data in `domain/types.ts`.
- **Forms:** local state + `TextField`/`Button` from `shared/components` (react-hook-form was
  removed along with email sign-up); `zod` is reserved for validating WS frames.
- **Maps:** `react-native-maps`; location with `expo-location` (permissions in `app.config.ts`).
  Shared map style: `features/booking/presentation/mapStyle.ts` (`declutteredMapStyle`).
- **Route appearance:** every view reuses `RoutePolyline` and
  `RoutePinMarker`; tracking and negotiation also use `TripRouteMap`.
  `routeTooltipLayout.ts` holds the common logical measures: stroke 3,
  outline 5 and an A/B pin of 16, with no size variants per role. Configure
  keeps editing when tapping the markers and always shows the Origen/Destino
  tooltips; the two top A/B blocks and the place-names toggle were removed
  to enlarge the map. Its framing reserves the full header and
  minimal margins; `getLabelAwareFitCoordinates` (`routeTooltipLayout.ts`) adds the
  corners of each tooltip with its measured size (`onLabelSize` from `RoutePinMarker`) and
  the real side/separation from `placeTooltipClearOfRoute`, so they do not leave the visible
  area without losing zoom on the rest. The Mercator projection (`mercatorY`,
  `longitudeDelta`) lives only in that file. Do not duplicate the polyline or
  the pin styles in a screen. Keep the non-collapsable native container,
  the cancellable redraw after layout changes and the late second redraw
  (400 ms, avoids blank bitmaps). The route A/B pin has the same shape as the
  selection pin (circle, stem and dot): the stem tip is the exact coordinate
  in every view (passenger and driver). `computePinAnchor` receives the height
  derived from the measured label (not the container's `onLayout`, which can
  arrive late and lift a label-below pin). The `Marker` uses `key={placement}`:
  Android keeps a stale bitmap when the label switches sides.
  Tooltip placement checks every segment in the screen
  projection and measures the whole block (text and Editar). Route maps are
  top-down and locked (no dragging, zoom or rotation), per the user's request
  of 2026-09-19. Configure keeps a stable-height panel between services
  and the map from the top edge, with a floating Back and a measured header;
  tracking uses compact 40/44 margins and reserves more space only for
  long addresses. Search measures header/panel, limits the sheet to 64 % and
  shows the moto notice inside the panel so large text does not cover the route.
  Every map disables `showsBuildings`, `showsIndoors`,
  `showsIndoorLevelPicker` and `pitchEnabled`. The shared style hides the geometry
  of buildings, terrain and POIs, keeping parks/streets/names; enabling
  place names must not restore shadows or interiors. See plan 0021. Room is
  searched above/below with a bounded separation. If it does not fit, keep A/B and its
  title on tap, without drawing the label over the route or enlarging the bitmap
  without limit. The edit/selection onPress stays available.
  **Pickup phase** (`accepted`/`arriving`): `TripRouteMap phase="pickup"` (passenger
  `TripScreen` and driver `DriverTripInProgressScreen`) draws only the driver → pickup
  route (A "Recogida", no B) and frames driver + route + pickup; with no position yet
  or once the driver is there it centers the pickup at zoom 17. `usePickupRoute`
  keys Google Routes by a ~220 m grid cell of the driver (`domain/pickupRoute.ts`),
  never by the raw 1 s GPS fix, and trims the cached line to the vehicle.
  After modifying the maps, also verify the Android bundle with Metro:
  TypeScript and unit tests do not catch every resolution failure
  of the dev server the phone receives.
- **AppState-aware hooks** (they do not freeze in the background): `useCountdown`, `socket.ts` recompute
  when returning to foreground. Follow that pattern for hooks with time/connection.
- Code, identifiers, comments, JSDoc and documentation in **English**, per the persistent preference in `../AGENTS.md`. Keep the UI in Spanish and verify every implementation.
- Before touching Expo APIs, confirm signatures in the **v56** docs (do not assume earlier versions).


### ETA and route choice

The offer ETA is computed automatically from a recent GPS position of the
driver to the pickup, using the active vehicle also for parcels. Do not
reintroduce manual minutes or use the origin→destination duration as the arrival ETA.
Google Routes uses optimal traffic and alternatives; choose the fastest valid one, with
shorter distance as the tie-breaker. A valid response of 0 s and one point is accepted
as an immediate arrival: Google may omit zero distance. The offer keeps
the contractual minimum of 1 min, without manual estimates or invented straight lines.
Distinguish a nonexistent route, an incomplete response, an unavailable provider, timeout
and disconnection; preserve cancellations. Configure keeps the framing and controls
when switching service; errors are not disguised as a straight route. See plan 0014.


### Simultaneous negotiations

A driver can make offers to several passengers and each passenger can compare several
drivers in their single request. `useConcurrentOffers` uses per-send promises
to keep all callbacks even when they overlap, and queries the
`automatic-driver-offer` mutations to keep the per-request lock while navigating.
Do not use a loading modal or a global lock to compute ETA/send an offer.
The first valid acceptance assigns a single ride and withdraws the winner's other
offers. `OfferSentScreen` shows any assigned ride, even when another
negotiation was being viewed. See plan 0015.


Automatic offers send `expected_pool_version` from the displayed request.
A 409 requires refreshing/reviewing the request and recomputing the ETA; do not resend the
same old draft. The offer detail uses `useNegotiationRide` to recover
requests outside the first page. Exact rejection/expiry keep the
attempt of a different improvement in flight; they only invalidate the given ID. HTTP
responses of a previous ride do not replace another active one. See plan 0016.
