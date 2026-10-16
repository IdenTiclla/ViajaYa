# Location permission gate

2026-10-12 · Implemented locally; phone verification in progress · Base: `e0ff729`.

Design source: Claude Design canvas «Permission Gate de ubicación»
(https://claude.ai/artifact/Gba1EaekHLiDofGwEZqf3M), five 390×844 artboards.

## Problem

- A passenger who enters without granting location sees a grey placeholder instead of
  the map (`MapPlaceholder` in `HomeScreen.tsx`): an icon, one line of text and a small
  button. The map never loads and nothing explains what to do next.
- The same situation is handled four different ways: `HomeScreen` (`MapPlaceholder`),
  `DriverSearchMap` (`permissionCard`), `PickOnMapScreen` (`locationUnavailable`) and the
  silent `null` return of `watchLocation`. Each has its own copy and its own retry.
- `useCurrentLocation` collapses every failure into `'error'`, and the UI answers it with
  **«No pudimos obtener tu ubicación. Inténtalo de nuevo.»** (`HomeScreen.tsx:770`;
  also thrown from `locationService.ts:498-500`). It does not say what failed or what the
  user can do, and «Inténtalo de nuevo» sends them back into the same failure.
- GPS turned off (permission granted, provider disabled) is not distinguished from "no
  permission" in the passenger flow, although `checkLocationAvailability` already
  returns `'disabled'`.

## Goal

An **intercept (permission gate)** that owns every "we cannot use the location" situation
for screens that need it, with one specific, actionable screen per cause, and no generic
retry-message UX anywhere in the location path.

Product decisions (2026-10-12, confirmed by the product owner):

- **ViajaYa must be installable on every device**, including tablets without GPS. The
  Play Store listing must not filter out GPS-less devices (see "Device compatibility").
- **The gate shows on every cold start** on devices that can provide a location, while
  location is not usable (permission not granted or provider off). It is not remembered
  across launches.
- **The passenger is never stuck.** Every gate screen has a text button **Ahora no**.
  It closes the gate for the rest of the session and opens the map in *manual mode*
  (pickup chosen on the map, inDrive model). The next cold start shows the gate again.
- **If location is lost, a top banner offers a one-tap fix** (inDrive model):
  «No pudimos ubicarte. Toca para encender la ubicación.» Tapping it opens the system
  "turn on location" dialog. The banner appears when GPS is off during use, and
  stays visible in manual mode after «Ahora no». See `LocationBanner`.
- **The full-screen gate is an entry intercept, not a mid-session interruption.** It is
  evaluated once per cold start. If location degrades *after* the app is already in use
  (GPS switched off, permission revoked), the user gets the banner, never a blocking
  screen in the middle of a booking.
- **Devices that cannot locate at all** (no location hardware feature) never see the
  gate or the banner. A passenger there uses manual mode; nothing is shown about a
  problem they cannot fix.
- **Drivers have no «Ahora no».** A driver without a position cannot see nearby
  requests or share position with a passenger, so the driver gate stays blocking.

### UX rules (apply to every screen below)

1. **Never show a generic failure message.** Banned copy: «No pudimos obtener tu
   ubicación», «Inténtalo de nuevo», «Intenta de nuevo», «Algo salió mal», and a bare
   «Reintentar» whose only effect is to repeat the same call. The `LocationBanner`
   sentence «No pudimos ubicarte. Toca para encender la ubicación.» is allowed because
   it names the cause (GPS off) and ends in the one-tap fix; it lives only in
   `gateCopy.ts` and is only shown when the provider is actually off.
2. **Name the cause and the one action that fixes it.** There are exactly four causes
   (not asked yet / denied / blocked / GPS off). Every other condition is a *waiting*
   state, not an error (rule 3).
3. **Slow or missing fixes are not errors.** While there is permission and GPS is on, the
   map renders immediately and the position arrives when it arrives (last known →
   fused → continuous watch). The UI shows a passive, non-blocking status, never a
   blocking message and never a retry button. The app keeps trying on its own.
4. **Leave the gate automatically.** When the user fixes the cause (in the system dialog,
   in Settings or in the quick panel) the gate disappears on its own on the next
   foreground / poll. There are no «Ya la activé» / «Ya lo encendí» buttons: detection is
   automatic, so a manual re-check button would only be another way to see nothing happen.
5. **Ask only when the OS will actually show a dialog.** Never call
   `requestForegroundPermissionsAsync` when `canAskAgain` is false; go to Settings.
6. **Copy in Spanish, identifiers and docs in English**, per `CLAUDE.md`.
7. **Never trap a person.** The passenger always has **Ahora no**; the driver, who cannot work
   without a position, has the screen's single action. **Never block a device for something
   it cannot change.** If the hardware cannot
   provide a location, the gate does not exist for that device (passenger → manual mode;
   driver → an informational `unsupported` screen with a way back to passenger mode).

## Current behaviour that matters

| Piece | Today |
|---|---|
| `locationService.getCurrentLocation` | Calls `requestForegroundPermissionsAsync()` immediately on mount (no primer), returns `{status:'denied', canAskAgain}` or a position; **throws** on timeout (10 s). |
| `useCurrentLocation` | `loading / granted / denied / error` (+ `canAskAgain`, `isEstimated`, `retry`). `retry: false`, `staleTime: 60 s`. |
| `checkLocationAvailability` | Silent: `granted / denied / disabled`; does not distinguish *undetermined* from *denied*. |
| `useWatchPosition` (driver) | `loading / granted / denied / disabled / error`; after 15 s without a fix it sets `'error'` while keeping the listener alive. |
| `getRoutingCoordinates` | Requests the permission and throws Spanish strings for denied, disabled, timeout and imprecise. |
| Android GPS settings | `DriverSearchMap` already does `Linking.sendIntent('android.settings.LOCATION_SOURCE_SETTINGS')`, falling back to `Linking.openSettings()`. |
| Dependencies | No `react-native-svg`, no AsyncStorage; `expo-secure-store` and `Ionicons` are available. Tests: `node --test tests/*.test.mjs`. |

## Architecture

Follows the feature layers in `mobile/CLAUDE.md` (presentation → application → data → domain).

```
features/location/                      # NEW feature (moved out of "home" because the gate is cross-feature)
├── domain/
│   ├── gateState.ts                    # LocationGateState + resolveGateState() — pure
│   └── gateCopy.ts                     # all Spanish copy, one object per variant
├── data/
│   ├── locationPermission.ts           # silent snapshot: permission + provider; request; open settings
│   └── lastKnownLocation.ts            # persisted last fix (SecureStore, small JSON)
├── application/
│   ├── useLocationGate.ts              # the state machine hook (single source of truth)
│   └── useLocationFix.ts               # position acquisition: never errors, only phases
└── presentation/
    ├── LocationGate.tsx                # wrapper: renders gate screen or children
    ├── LocationGateScreen.tsx          # one layout, 4 variants (+ theme)
    ├── GateHero.tsx                    # map backdrop + pin / badge (Views, no SVG lib)
    ├── GateSteps.tsx                   # numbered steps card (Blocked)
    ├── LocatingChip.tsx                # passive "waiting" status over the map
    └── LocationBanner.tsx              # top banner: "No pudimos ubicarte · Toca para encender la ubicación"
```

`features/home/data/locationService.ts` and `watchLocation.ts` stay where they are for
now (they have many importers); the new feature calls into them. Moving them is out of
scope.

### Domain: the state machine

```ts
type PermissionSnapshot = {
  status: 'undetermined' | 'denied' | 'granted';
  canAskAgain: boolean;
  servicesEnabled: boolean;      // Location.hasServicesEnabledAsync()
};

type LocationGateState =
  | { kind: 'checking' }                       // first silent read, < 150 ms, renders nothing
  | { kind: 'primer' }                         // screen 1
  | { kind: 'denied' }                         // screen 2  (can ask again)
  | { kind: 'blocked' }                        // screen 3  (must go to Settings)
  | { kind: 'services-off' }                   // screen 4
  | { kind: 'manual'; reason: 'dismissed' | 'no-capability' }  // passenger: map without GPS
  | { kind: 'unsupported' }                    // driver on a device with no location capability (informational, not fixable)
  | { kind: 'open' };                          // gate is transparent, children render

function resolveGateState(
  s: PermissionSnapshot | null,
  askedThisInstall: boolean,
  capability: 'capable' | 'none', // does the device have any location hardware feature?
  role: 'passenger' | 'driver',
  session: { entryDone: boolean; dismissed: boolean }, // in memory only, reset on every cold start
): { gate: LocationGateState; banner: LocationBannerCause | null }

type LocationBannerCause = 'services-off' | 'permission-denied' | 'permission-blocked';
```

- `capability === 'none'` short-circuits everything: `manual` (`no-capability`) for the
  passenger, `unsupported` for the driver; **no banner** in either case.
- `session.dismissed` (passenger tapped **Ahora no**) turns any blocking gate state into
  `manual` (`dismissed`) and sets the banner cause from the snapshot. Driver: ignored.
- `session.entryDone` becomes `true` the first time the gate resolves to `open`, or on
  **Ahora no**. Once `true`, a snapshot that stops being usable yields
  `gate: open`/`manual` plus a `banner` cause, never a gate screen again until the next
  cold start.
- A usable snapshot always wins over `dismissed`: if the user turns GPS on or grants the
  permission while in manual mode, the state goes to `open` and the banner disappears.
- Nothing is persisted about the gate, which is what makes it return on every cold start
  while the cause persists.

Resolution table (pure, fully unit-tested):

| status | canAskAgain | servicesEnabled | askedThisInstall | State |
|---|---|---|---|---|
| `null` (not read yet) | – | – | – | `checking` |
| `undetermined` | true | any | any | `primer` |
| `denied` | true | any | false | `primer` (Android can report denied+canAskAgain after a fresh install migration) |
| `denied` | true | any | true | `denied` |
| `denied` | false | any | any | `blocked` |
| `granted` | – | false | – | `services-off` |
| `granted` | – | true | – | `open` |

Notes:
- **iOS** returns `canAskAgain: false` right after the first denial, so iOS goes
  `primer → blocked` and never shows screen 2. This is expected, not a bug.
- **Android** allows two in-app denials; the third time the OS reports
  `canAskAgain: false` → `blocked`.
- «Permitir solo esta vez» (Android 11+) grants for the session; the gate opens, and the
  next cold start returns to `primer`/`denied` as the OS dictates.
- Permission is `granted` but only *approximate* location (iOS 14+/Android 12+): treated
  as `open`. The fix quality is handled by `useLocationFix` (see below), not by the gate.
- `askedThisInstall` is a boolean kept in `SecureStore` (`location_gate_asked`), set when
  the system dialog is first requested. It keeps screen 2 from appearing before the user
  ever saw the dialog.

### Application: `useLocationGate()`

```ts
function useLocationGate(): {
  state: LocationGateState;
  busy: boolean;                      // a system dialog or a recheck is in flight
  requestPermission: () => Promise<void>;  // primer / denied CTA
  openAppSettings: () => Promise<void>;    // blocked CTA
  openLocationSettings: () => Promise<void>; // services-off CTA
  banner: LocationBannerCause | null; // drives <LocationBanner/>
  dismissForSession: () => void;      // "Ahora no" (passenger only; no-op for driver)
  fixBanner: () => Promise<void>;     // banner tap: requestPermission | openAppSettings | openLocationSettings by cause
};
```

Behaviour:

1. **Mount:** one silent read (`getForegroundPermissionsAsync` + `hasServicesEnabledAsync`)
   → `resolveGateState`. No dialog.
2. **`requestPermission()`** (screens 1 and 2): sets `busy`, marks `askedThisInstall`,
   calls `requestForegroundPermissionsAsync()`, re-reads the snapshot. Result decides the
   next state (granted → `open`; denied+canAskAgain → `denied`; denied → `blocked`).
   Android quirk: if the OS returns immediately with no dialog (it was already
   `canAskAgain:false`), the re-read lands on `blocked`; that is the intended transition.
3. **`openAppSettings()`** (screen 3): `Linking.openSettings()`.
4. **`openLocationSettings()`** (screen 4): on Android first try
   `Location.enableNetworkProviderAsync()` (system "turn on location" sheet, no
   navigation); if it rejects, `Linking.sendIntent('android.settings.LOCATION_SOURCE_SETTINGS')`;
   last resort `Linking.openSettings()`. iOS: `Linking.openSettings()`.
5. **Auto re-check:**
   - `AppState` → `active`: re-read (covers returning from Settings / permission change
     while backgrounded).
   - While the cause is `services-off` (gate screen 4 **or** the banner): poll
     `hasServicesEnabledAsync()` every 1.5 s, only while the app is `active` and the screen is focused (the quick panel does not
     background the app, so `AppState` alone is not enough). Stop the timer on leave.
   - While state is `blocked`: no polling needed; `AppState` covers Settings round trips.
6. **GPS turned off mid-session** (`granted` → `servicesEnabled:false`) is detected by the
   same 1.5 s poll while a gated screen is focused (it runs always, not only in
   screen 4, but only for screens that mount the gate; it costs one native call per tick).
   The result is `banner: 'services-off'`, never a gate screen (see `entryDone`).
   It also runs a re-read on `AppState` → `active`.
7. A single module-level subscription store (like `createThemeStore`) so every gate
   instance in the app shares the snapshot and the `busy` flag; two screens mounting
   the gate must not open two system dialogs.

### Application: `useLocationFix()` — acquisition without errors

Replaces the `'error'` branch of `useCurrentLocation` for everything behind the gate.
Only mounts when the gate is `open`.

```ts
type LocationFix =
  | { phase: 'locating'; coordinates: Coordinates | null }          // cached/last known may already be present
  | { phase: 'ready'; coordinates: Coordinates; isEstimated: boolean; accuracy: number | null }
  | { phase: 'weak'; coordinates: Coordinates | null };             // > 12 s with no fix; still trying
```

- Start order: persisted last fix (`lastKnownLocation`, ≤ 24 h, flagged `isEstimated`)
  → `getLastKnownPositionAsync` → `getCurrentPositionAsync(Balanced)` → continuous
  `watchPositionAsync` kept alive (same pattern the driver already uses in
  `useWatchPosition`: the listener survives the timeout and a late signal recovers the map).
- **No terminal failure state.** Timeouts only move `locating → weak`; a later fix moves
  `weak → ready` automatically. No `retry` is exposed to the UI.
- The map renders in `locating` and `weak` (centered on the cached fix if any, otherwise
  on the territory default already used for Bolivia). Only the chip below communicates
  status.
- **Manual mode** (`gate.kind === 'manual'`) does not run
  `useLocationFix` at all: no permission request, no listener. The map is centered on the
  persisted last fix (any age, shown as a plain map, not as «tu ubicación») or the
  territory default.
- Persist every accepted fix with accuracy ≤ 200 m to `lastKnownLocation` (throttled to
  once per 30 s) so the next cold start opens on the previous position instead of a blank map.
- Validation rules from `watchLocation.receivePosition` (finite coordinates, ≤ 30 s old,
  not in the future) are reused unchanged.
- `getRoutingCoordinates()` (used for pickup routing) stops throwing user-facing strings:
  it throws a typed `LocationUnavailableError` with `reason: 'permission' | 'services' |
  'timeout' | 'imprecise'`. Callers translate: `permission`/`services` → the gate is
  already visible (re-read it); `timeout`/`imprecise` → keep the last good route/estimate
  and show the `weak` chip. The three Spanish `throw new Error('…')` strings at
  `locationService.ts:~487-505` are deleted.

### Presentation

#### `LocationGate`

```tsx
<LocationGate>{children}</LocationGate>
```

Renders `null` while `checking`, `LocationGateScreen variant=…` for the four blocking
states, otherwise `children`. Uses `useLocationGate()`. Screen is **full height inside
the host screen**, so the bottom tab bar stays reachable (see "Where the gate mounts").

#### `LocationGateScreen` (shared layout for screens 1-4)

Layout from the design (390 × 844 reference):

- **Hero** (`GateHero`, 340 px on 1-2-4, 250 px on 3; scales with safe-area top, never
  below 220 px): map backdrop built from `Views` using the existing tokens
  (`mapLand`, `mapWater`, `mapPark`, `mapMainRoad`, `mapStreet`) — two roads, one water
  band, one park block — plus a bottom fade to `background` (`expo-linear-gradient` if
  already a dependency, else a 6-step stacked `View` fade). No new image assets.
- **Content** (padding 24, 8 top, 28 bottom): `h1` 28/34 bold, body 16/24
  `textSecondary`, variant-specific block, flexible spacer, CTA, secondary text action.
- **CTA**: existing `shared/components/Button` (primary), height 56, radius 16, leading
  icon. Secondary: text button, height ≥ 48.
- **Typography**: brand font via `useBrandFontStyle()` on the title only; body keeps the
  system font like the rest of the app. (The design used Ubuntu for everything; only the
  wordmark/title justify loading it.)
- **Theme**: `useThemedStyles(createStyles)`; no hard-coded hex. Dark mode is automatic.
- **Accessibility**: title is `accessibilityRole="header"` and receives screen-reader
  focus on mount; hero is `accessibilityElementsHidden`/`importantForAccessibility="no-hide-descendants"`
  except the badge, which carries the label; buttons have explicit labels; the status
  caption is an `accessibilityLiveRegion="polite"`; all targets ≥ 48; text scales with
  system font size (the content block scrolls in a `ScrollView` with `flexGrow` so large
  text never clips the CTA).
- **Secondary action: «Ahora no»** (passenger only), a text button ≥ 48 high, in the slot
  where the canvas drew «Por qué la necesitamos» (2), «Ya la activé» (3) and
  «Ya lo encendí» (4); screen 1 gains it (it had none). → `dismissForSession()`. It
  replaces those three buttons, which are removed (automatic detection covers them).
  **The driver variant renders no secondary action.** Update the canvas copy of
  artboards 1-4 before implementing (text change on 2-4, one new button on 1).
- **Back button**: none. The ways out of the gate are fixing the cause, «Ahora no»
  (passenger) or the tab bar.

#### Screen 1 — Primer (`kind: 'primer'`, canvas «1 · Primer»)

Purpose: explain *before* the OS dialog, so the user is more likely to accept it.

- Hero: map, brand-blue pin (`primary`) with yellow (`accent`) core, three concentric
  `primary` rings at 7 / 11 / 16 % opacity.
- Title: **Activa tu ubicación**
- Body: «Para mostrarte el mapa y los conductores cercanos, ViajaYa necesita saber dónde estás.»
- Benefits (icon tile `primarySoft` + text, 40 px tile, radius 12):
  1. `locate-outline` — «Te ubicamos como punto de recogida»
  2. `car-outline` — «Ves los conductores que tienes cerca»
  3. `lock-closed-outline` — «Solo la usamos mientras usas la app»
- CTA: `navigate` icon + **Permitir ubicación** → `requestPermission()`.
- Caption: «El sistema te pedirá confirmar. Elige «Mientras usas la app».»
- Copy for the driver variant (see Roles): body «Para mostrarte las solicitudes cercanas
  y compartir tu posición con tu pasajero, ViajaYa necesita saber dónde estás.»
- Secondary: **Ahora no** (passenger) → `dismissForSession()`; driver: none.
- Transitions: granted → `open`; denied+canAskAgain → screen 2; denied → screen 3.

#### Screen 2 — Denied, can ask again (`kind: 'denied'`, canvas «2 · Denegado»)

- Hero: same map at 55 % opacity, grey pin (`controlBorder`) with a `danger` circular badge
  containing a close icon, `background` ring around the badge.
- Title: **Sin ubicación no hay mapa**
- Body: «No diste permiso de ubicación, así que no podemos mostrarte el mapa ni pedir un viaje desde donde estás.»
  (driver: «…ni mostrarte solicitudes cerca de ti.»)
- Info card (`dangerSoft` bg, `dangerBorder` 1 px, radius 16, `alert-circle-outline`
  in `danger`): «Puedes activarla ahora. Solo toma un toque y la usamos únicamente
  mientras tengas la app abierta.»
- CTA: **Permitir ubicación** → `requestPermission()`.
- Secondary: **Ahora no** (passenger) → `dismissForSession()`; driver: none.
- Transitions: same as screen 1. After a second denial on Android → screen 3.
- This screen is Android-only in practice (see state-table note on iOS).

#### Screen 3 — Blocked, go to Settings (`kind: 'blocked'`, canvas «3 · Bloqueado»)

- Hero (250 px): map at 55 %, grey pin with `danger` badge containing a lock.
- Title: **Actívala desde Ajustes**
- Body: «Tu teléfono ya no nos deja volver a preguntar. Solo tú puedes activarla, en tres pasos:»
- `GateSteps` card list (`surfaceMuted`, radius 16, number badge `primary`/`textOnPrimary`):
  1. «Toca **Abrir ajustes**»
  2. Android «Entra en **Permisos › Ubicación**» · iOS «Entra en **Ubicación**»
  3. Android «Elige **Permitir mientras se usa la app**» · iOS «Elige **Mientras se usa la app**»
  (copy chosen with `Platform.select`; the design shows the Android wording.)
- CTA: `settings-outline` + **Abrir ajustes** → `openAppSettings()`.
- Secondary: **Ahora no** (passenger) → `dismissForSession()`; driver: none.
- Transitions: returning from Settings fires `AppState` re-check → `open` / `services-off`
  automatically.

#### Screen 4 — GPS off (`kind: 'services-off'`, canvas «4 · GPS apagado»)

- Hero: map at 55 %, 120 px circle in `warningSoft` with a `warning` 3 px ring and a
  crossed-out crosshair (`locate-outline` + diagonal bar `View`).
- Title: **Enciende el GPS**
- Body: «Ya diste permiso, pero la ubicación de tu teléfono está apagada. Enciéndela para ver el mapa y encontrar conductores.»
- Info card (`warningSoft`, `warning` icon `warning-outline`): Android «Desliza el panel de tu
  teléfono desde arriba y activa **Ubicación**.» · iOS «Ve a **Ajustes › Privacidad y
  seguridad › Localización** y activa **Servicios de localización**.»
- CTA: **Activar GPS** → `openLocationSettings()` (Android shows the system
  "turn on location" dialog, one tap, no navigation; same action as the banner).
- Secondary: **Ahora no** (passenger) → `dismissForSession()`; driver: none.
- Transitions: 1.5 s poll + `AppState`; the gate closes by itself the moment the provider is enabled.

#### Screen 5 — Dark mode (canvas «5 · Primer · modo oscuro»)

Not a separate component. All five variants resolve colors through the theme store, so
dark mode comes for free. This screen defines the dark acceptance criteria:

| Role | Token (dark) |
|---|---|
| Background | `background` `#10151F` |
| Map backdrop | `mapLand` `#172231`, `mapWater` `#0D1725`, `mapPark` `#203A34`, `mapMainRoad` `#43536A`, `mapStreet` `#334155` |
| Pin / CTA fill | `primary` `#A8BDFF`, label `textOnPrimary` `#10204E` |
| Benefit tiles | `primarySoft` `#273856` |
| Danger / warning cards | `dangerSoft`/`dangerBorder`, `warningSoft`/`warning` (all already dark-aware) |

Verification: every text/background pair ≥ 4.5:1 in both themes; the accent yellow core
stays `#F5C518` (fixed, like the brand tokens). Test with the Profile theme selector
(light / dark / system).

#### Manual mode (passenger)

`gate.kind === 'manual'` has two entries and one behaviour:

- `reason: 'dismissed'`: the passenger tapped **Ahora no**. Shown with the `LocationBanner`.
- `reason: 'no-capability'`: the device has no location hardware (e.g. a Wi-Fi tablet).
  No gate, no banner, no prompt: the missing location is normal, not a problem to fix.

Behaviour:

- **Home map:** no blue dot, no auto-centering on the user. The «my location» button, if
  visible, runs `fixBanner()` (it is the same action as the banner) when the device is
  capable and is hidden when it is not. The search/«¿A dónde vas?» entry and saved places work
  as always. The origin starts **unset**.
- **Pickup:** the user taps the origin field and goes through the existing `pick-on-map`
  flow (pin in the center, reverse-geocoded label), the inDrive model. `PickOnMapScreen`
  stops treating a missing fix as `locationUnavailable`; it starts centered on the
  persisted last fix or the territory default, and the «usar mi ubicación» shortcut is hidden.
- **Routing / ETA:** computed from the chosen origin, never from the device.
  `getRoutingCoordinates()` is only called when `gate.kind === 'open'`.
- **Recovery:** if the user turns GPS on or grants the permission (banner, quick panel,
  Settings), the state becomes `open`, the dot and centering appear, and an **already
  chosen** pickup is kept (a manual origin is never overwritten by the device position).
- Creating a ride is allowed; the request carries the chosen coordinates like any other.
  No backend change.

#### `LocationBanner` — the one-tap fix (inDrive model)

A top banner that appears the moment location stops being usable and tells the user what to
tap. Same idea as inDrive's «We couldn't find you, tap to turn on location».

| `banner` cause | Copy | Tap action |
|---|---|---|
| `services-off` | «No pudimos ubicarte. Toca para encender la ubicación.» | `openLocationSettings()`: Android shows the system **"Turn on device location"** dialog (`Location.enableNetworkProviderAsync()`), the user taps OK and stays in the app; fallbacks `sendIntent(LOCATION_SOURCE_SETTINGS)` → `openSettings()`. iOS has no in-app dialog: `Linking.openSettings()`. |
| `permission-denied` (can ask) | «La ubicación está desactivada. Toca para permitirla.» | `requestPermission()` |
| `permission-blocked` | «La ubicación está desactivada. Toca para activarla en Ajustes.» | `openAppSettings()` |

- **When it shows:** (a) passenger in manual mode after **Ahora no** on a capable device;
  (b) any `open` session where GPS is switched off or the permission is revoked afterwards
  (e.g. the user pulls down the quick panel and disables Location, as in the inDrive
  example); (c) driver screens, same causes (the gate already covered the entry).
  **Never** on a device with `capability: 'none'`.
- **Where:** pinned to the top, below the safe-area inset, over the map and above the
  bottom sheet; 16 px side margin, min height 56, radius 16, `warningSoft` background,
  `warning` icon (`location-outline` with a slash badge) and `text` color copy at 15/22.
  Full-width tap target, whole banner is the button.
- **Behaviour:** appears with a 200 ms slide/fade (no animation when the OS reduces
  motion); disappears on its own when the 1.5 s poll / `AppState` sees recovery; it cannot
  be swiped away because it reports state, not news. While it shows, `LocatingChip` is
  hidden (the banner explains the real reason).
- **A11y:** `accessibilityRole="button"`, label equals the copy, `accessibilityLiveRegion="polite"`
  so TalkBack/VoiceOver announce it when it appears; text scales; contrast ≥ 4.5:1 in both themes.
- **Deep detail:** after the Android dialog resolves OK the OS still needs a few seconds
  to deliver a fix; during that time the banner is gone and `LocatingChip` shows
  «Buscando tu ubicación…».

#### `unsupported` — driver on a device with no location (informational)

A driver needs a live position, so this device cannot work in driver mode. Layout of
screen 4 without the CTA toggle: hero with the crossed-out crosshair in `controlBorder`;
title **Este dispositivo no puede conducir**; body «El modo conductor necesita la
ubicación del teléfono para mostrarte solicitudes y compartir tu posición con el
pasajero. Puedes seguir usando ViajaYa como pasajero.»; CTA **Volver al modo pasajero**
(existing `useSwitchAccountMode({mode:'passenger'})`). Needs one extra artboard in the
canvas. Practically unreachable on phones; it exists so a GPS-less tablet is never trapped. No banner here.

#### `LocatingChip` — the replacement for the generic error

Shown over the real map (never replacing it) when the gate is `open` and the fix is not
`ready`. Pill at the top, below the safe area, `surface` bg with elevation, 44 px high,
`accessibilityLiveRegion="polite"`, **no button**.

| `useLocationFix` phase | Chip |
|---|---|
| `locating` (0-12 s) | spinner + «Buscando tu ubicación…» |
| `weak` (> 12 s) | `cellular-outline` + «Señal de GPS débil. Sal a un lugar abierto y seguimos buscando.» |
| `ready` with `isEstimated` | `time-outline` + «Mostrando tu última ubicación conocida» (disappears when the precise fix lands) |
| `ready` | hidden |

In `weak` (passenger), a secondary affordance appears *inside* the chip, not as an alert:
a text action **Elegir en el mapa** that opens the existing `pick-on-map` flow so the user
can book without waiting for the fix. It is an alternative path, not a retry, and the
background search continues. For the driver, `weak` shows only the text.

## Device compatibility (Google Play)

**Finding:** the generated manifest (`android/app/src/main/AndroidManifest.xml`, produced from
`app.config.ts`) requests `ACCESS_FINE_LOCATION` and `ACCESS_COARSE_LOCATION` and declares
**no** `<uses-feature>`. Android then *implies* `android.hardware.location.gps` and
`android.hardware.location` as **required**, and Google Play hides the app from every device
without GPS (most Wi-Fi tablets, some Chromebooks). That contradicts the goal.

Changes:

1. **Declare the features optional** with a small config plugin
   (`plugins/withOptionalLocationFeatures.ts`, a `withAndroidManifest` mod) adding:
   `<uses-feature android:name="android.hardware.location" android:required="false"/>`,
   `<uses-feature android:name="android.hardware.location.gps" android:required="false"/>`,
   `<uses-feature android:name="android.hardware.location.network" android:required="false"/>`.
   Register it in `app.config.ts`. The same check applies to any other
   permission-implied feature (`android.hardware.telephony`, `android.hardware.touchscreen`,
   `android.hardware.camera` if ever added): required only when truly needed.
2. **Verify after prebuild**: `npx expo prebuild --clean` (or the existing regeneration step),
   then inspect the merged manifest (`./gradlew :app:processReleaseMainManifest`) and, on a
   release bundle, `aapt dump badging app.apk | grep -i "uses-feature\|uses-implied"` must
   list the three features as `required=false` and **no** `uses-implied-feature` for GPS.
   Confirm in Play Console › Device catalog that a GPS-less tablet is supported.
3. **Detect capability at runtime** (the thing Expo does not expose): a tiny local Expo
   module `modules/location-capability` (Expo Modules API). Android:
   `PackageManager.hasSystemFeature` for `android.hardware.location.gps` **or**
   `android.hardware.location.network`; iOS: always `true` (every iPhone/iPad reports
   Wi-Fi/cellular location). Exposes `getLocationCapability(): 'capable' | 'none'`, read
   once at startup and cached. This is hardware capability only; it says nothing about
   permission or whether GPS is switched on (that is the gate's job).
   Requires a new dev build, not a Metro reload.
   Fallback if a native module is unwanted: treat the device as `capable` and let the
   passenger use the weak-signal chip action; the cost is that a GPS-less tablet would see
   screen 4 with nothing to enable. Not recommended.

## Where the gate mounts

Decision: **gate the screens that need a position, not the whole role group.** Wrapping
`(app)/_layout` or `(driver)/_layout` would also lock History, Wallet and Profile (where
the user switches mode or signs out) behind a permission they do not need.

| Screen | Gate behaviour |
|---|---|
| Passenger `HomeScreen` (Trip tab) | `<LocationGate>` wraps the map + sheet. Replaces `MapPlaceholder` entirely. Shown on every cold start while location is unusable on a location-capable device; «Ahora no» switches to manual mode with the banner; devices without location capability skip the gate and use manual mode. `LocationBanner` is rendered by this screen (and by Requests / PickOnMap) for mid-session loss. `ActiveRideGate` ("Verificando tus viajes…") still runs first, so a passenger with an active ride is routed to it before any gate is shown. |
| Driver `IncomingRequestsScreen` (Requests tab) | `<LocationGate>` wraps the pool map. Replaces the `permissionCard` in `DriverSearchMap`. Driver copy variant. Not shown while a ride is active: navigation/tracking own that state. |
| Passenger `PickOnMapScreen` | **Not gated**: it is the manual path. It shows `LocationBanner` when the device is capable and location is off. The `locationUnavailable` branch is deleted; without a fix it opens on the last fix / territory default. |
| Booking screens that only *consume* a chosen origin (configure, offers, trip) | No gate. |
| History / Wallet / Profile (both roles) | No gate. |

A `variant: 'passenger' | 'driver'` prop selects the two copy sets in `gateCopy.ts`.

Background permission (`locationAlwaysAndWhenInUse…`) is **out of scope**: the gate only
covers foreground. The driver's active-ride tracking keeps its own flow
(`features/tracking`).

## Changes by file

New: everything under `features/location/` listed above, plus `tests/location-gate.test.mjs`.

Modified:
- `features/home/presentation/HomeScreen.tsx`: remove `MapPlaceholder` and its styles,
  `BOLIVIA_SERVICE_AREA_MESSAGE` placeholder branch becomes a `LocatingChip`-style notice
  (outside-area is a *valid* terminal state with its own copy and a «Elegir en el mapa» action,
  not an error); use `useLocationFix()`.
- `features/home/application/useCurrentLocation.ts`: keep as a thin adapter over
  `useLocationFix` during migration, then delete `'error'` from `LocationStatus` and
  remove `retry` from its public type. Migrate `PickOnMapScreen` (the only other consumer).
- `features/home/application/useWatchPosition.ts`: drop `'error'` from `WatchStatus`
  (the 15 s timer maps to `weak`); `denied`/`disabled` are now owned by the gate and
  may be removed once `DriverSearchMap` stops rendering them.
- `features/driver/presentation/DriverSearchMap.tsx`: delete the permission card and its
  copy; render `LocatingChip` when there are no coordinates.
- `features/booking/presentation/PickOnMapScreen.tsx`: drop the `locationUnavailable` path; render `LocationBanner`.
- `features/home/data/locationService.ts`: `getCurrentLocation` no longer requests the
  permission itself (the gate does); typed `LocationUnavailableError`; delete the Spanish
  throw strings; export a persisted-last-fix hook point.
- `features/home/data/watchLocation.ts`: remove the `requestForegroundPermissionsAsync`
  call from `watchLocation` (requesting is the gate's job); return `null` only when
  permission/provider is missing.
- `app.config.ts`: register `plugins/withOptionalLocationFeatures` (see "Device compatibility"); refine `locationWhenInUsePermission` to match the primer copy
  («ViajaYa usa tu ubicación mientras tienes la app abierta para mostrar tu posición en el
  mapa y coordinar tu viaje.»). Requires a new dev build for the iOS string.

## Implementation phases

Each phase ends green: `npx tsc --noEmit`, `npm run lint`, `npm test`.

0. **Compatibility first** (ships independently, protects installs): the manifest plugin and its
   verification from "Device compatibility".
1. **Domain.** `gateState.ts` (`resolveGateState`), `gateCopy.ts`. Unit tests for the
   full resolution table including iOS/Android sequences.
2. **Data.** `modules/location-capability` (native), `locationPermission.ts` (snapshot/request/open settings, Android
   `enableNetworkProviderAsync` with fallbacks), `lastKnownLocation.ts` (SecureStore,
   24 h TTL, schema-validated on read: finite coordinates or discard).
3. **Application.** `useLocationGate` (shared store, AppState, 1.5 s services poll with
   cleanup, dialog single-flight) and `useLocationFix` (phases, persisted fix, continuous
   watch). Tests with the Expo location module mocked.
4. **Presentation.** `GateHero`, `LocationGateScreen` + the four variants, `GateSteps`,
   `LocatingChip`, `LocationBanner`, `LocationGate`. Hand-check against the canvas at 390×844, 360×640,
   a 412×915 device and with font scale 1.3 / 2.0, light and dark.
5. **Wire-up.** Passenger Home first (the reported bug), then Requests, then PickOnMap.
   Remove `MapPlaceholder`, `permissionCard`, `locationUnavailable`.
6. **Copy sweep.** Delete every banned string (rule 1) and add the guard test below.
7. **Phone verification** (see matrix) and plan closing.

## Tests

Pure/Node (`tests/location-gate.test.mjs`, same style as existing `.mjs` tests):

- `resolveGateState` table: all rows, plus undetermined → denied → blocked sequence per platform.
- `gateCopy` has all four variants × two roles × two platforms, no empty strings.
- **Banned-copy guard:** scan `src/` (excluding tests) for `No pudimos obtener`,
  `Inténtalo de nuevo`, `Intenta de nuevo` and fail on any hit; this prevents the old
  UX from coming back.
- `lastKnownLocation` rejects NaN / out-of-range / stale payloads.
- `useLocationFix` reducer: `locating → weak → ready`, `weak` never becomes a terminal
  state, a late fix after 15 s recovers.
- `resolveGateState` session rules: `dismissed` → `manual` for passenger only; `entryDone`
  turns a later `services-off`/revoked permission into `open|manual` + banner cause instead
  of a gate screen; a usable snapshot beats `dismissed`; `session` is a fresh object on every
  store creation (cold start).
- `gateCopy`: the banner sentence exists once, only in `gateCopy.ts`; the banned-copy guard
  allowlists exactly that file for «No pudimos ubicarte».
- `resolveGateState` with `capability: 'none'`: `manual` for passenger, `unsupported` for
  driver, regardless of permission/provider state; with `'capable'` the table above applies.
- `useLocationGate`: no second system dialog while `busy`; no request when
  `canAskAgain` is false; `AppState` active triggers a re-read; services poll stops on unmount.

## Verification matrix (phones; no emulator)

| Scenario | Expected |
|---|---|
| Fresh install, passenger, open Trip tab | Screen 1; CTA opens the OS dialog |
| Dialog → *Mientras usas la app* | Gate closes; map shows with `LocatingChip` until the fix |
| Dialog → *No permitir* (Android) | Screen 2; CTA re-opens the dialog |
| Deny a second time (Android) / first time (iOS) | Screen 3 |
| Screen 3 → Settings → grant → back | Gate closes with no tap |
| Permission granted, GPS off | Screen 4; turning GPS on from the quick panel closes the gate within ~2 s |
| Granted + GPS on, indoors / no fix | Map visible, chip «Buscando…» then «Señal de GPS débil…»; never a retry message; fix arrives → chip disappears |
| Cold start after a previous session, no signal yet | Map opens on the last known position with the «última ubicación» chip |
| Approximate-only permission (Android 12+) | Gate open; map works with the coarse fix |
| Driver, Requests tab | Same four screens with driver copy; History/Profile stay reachable |
| Gate screen 1-4 as passenger, tap **Ahora no** | Map in manual mode with the banner; pickup can be pinned and a ride requested |
| Same session, leave the Trip tab and come back | No gate again; banner still there |
| In manual mode tap the banner (GPS off) | Android: system "Turn on device location" dialog; OK → banner disappears, dot appears, a pinned pickup is kept |
| App open with GPS on, pull the quick panel and switch Location off | Within ~2 s the banner «No pudimos ubicarte…» appears; no full-screen gate |
| Tap that banner → OK in the dialog | Banner disappears; `LocatingChip` shows until the fix arrives |
| iOS, GPS off, tap the banner | Opens Settings; returning re-checks and clears the banner |
| Kill and reopen the app (still no permission) | Gate shows again every time |
| Tablet without GPS (Wi-Fi only) | App installs from Play; no gate; map works; pickup chosen on the map; ride can be requested |
| Same tablet in driver mode | `unsupported` screen with «Volver al modo pasajero» |
| Play Console device catalog | A GPS-less tablet is listed as supported (no `android.hardware.location.gps` filter) |
| Driver on a phone, permission denied | Gate stays; no «Ahora no» |
| Driver online, GPS switched off | Banner on Requests; no full-screen gate mid-session |
| Dark theme, font scale 2.0 | No clipped CTA, contrast ≥ 4.5:1 |
| Rotate / kill app on screen 3 and return | State recomputed correctly |

## Evidence (2026-10-12)

- Mobile: **502 tests passing** (23 new in `tests/locationGate.test.mjs`: resolution table, session
  rules, capability, copy guard, fix phases, stored fix, shared store). `routingLocation.test.mjs`
  now asserts the typed `LocationUnavailableError` reasons. `tsc --noEmit` and `npm run lint` clean.
- APK (`assembleDebug`): `aapt dump badging` lists `android.hardware.location`, `.gps` and `.network`
  as `uses-feature-not-required` and no implied GPS feature.
- Phone (POCO F2 Pro, dev build): the primer renders with the driver copy and no «Ahora no», the hero
  shrinks to keep the button in view, the button opens the system dialog (button in loading state
  meanwhile) and, once granted, the gate closes and the driver map shows the vehicle and radar.
  No JS errors in logcat/Metro.
- Not yet verified on the phone: passenger variants, denied/blocked/GPS-off screens, «Ahora no» and
  manual mode, the banner on GPS loss, dark mode and font scale 2.0.

## Out of scope

- Background location permission and the driver tracking foreground service (`0022`).
- Server-side or analytics tracking of permission outcomes.
- Moving `locationService`/`watchLocation` into `features/location` (follow-up refactor).
- Web layouts and tablet-specific (large screen) layouts; GPS-less tablets are supported with the phone layout.

## Decisions closed (2026-10-12)

1. The app installs on every device: GPS is declared optional (see "Device compatibility").
2. The gate is an entry intercept: it shows on every cold start on location-capable
   devices. The passenger can leave it with **Ahora no** (session-only); the driver cannot.
3. Losing location mid-session never opens a full-screen gate: a top `LocationBanner`
   with a one-tap fix (inDrive model) appears instead.
4. Devices with no location capability get manual mode (passenger) or `unsupported`
   (driver), no gate and no banner.
5. With the gate open and a weak signal, the passenger may pick the pickup on the map.

## Open question

- Manual mode (and the weak-signal chip action) lets a passenger request a ride from a point they typed/pinned, which can
  be far from where they actually are. The plan adds no distance check. If abuse or
  mis-pickups show up, a later plan can compare the pin with the last known fix and ask
  for confirmation only when they differ by more than a threshold.
