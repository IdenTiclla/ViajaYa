# Driver navigation and location visible to the passenger

2026-09-19 · Local implementation verified; phone certification pending · Base: `e10e6ae`.

The previous commit gathers the flows and fixes up to revision 21: 731 backend
tests, 396 mobile, Ruff/TypeScript/lint passing. No push was made.

## Delivery

- Authorized tracking from assignment until closing, with position, accuracy,
  capture time, a stale-signal notice and recovery by snapshot.
- GPS publication with the driver's permissions; Android continuity when opening Waze.
  Recent location only, without storing a coordinate history in the outbox.
- A private per-ride location WebSocket channel, independent of the durable
  negotiation streams. Shared HTTP to upload samples and recover the
  last position; Redis in distributed mode, memory in local development.
- Native Google navigation to the pickup and then the destination. Start/arrival/close
  still depend on the confirmed ride status; the SDK does not advance the service.
- Optional Waze with the destination of the current stage, Google voice pause, return
  and handling of an app that is not installed. No GPS or ETA is obtained from Waze.
- Top-down views without buildings/interiors; keep the requested light theme.

## Compatibility

Expo 56 / React Native 0.85.3. The official Google Navigation wrapper is pinned at
0.16.3: the current version requires RN 0.87+. Effective compatibility with 0.85.3
was verified by building Android for the four architectures. The plugin replaces
the Maps dependency with Navigation 7.6.1 both when compiling react-native-maps and
when packaging the app; it does not duplicate classes. iOS keeps its existing maps and stays
outside this native integration until its dependencies are certified.
TaskManager uses the compatible version resolved by Expo 56. The native
integration requires installing a new APK; reloading Metro does not add native modules.

## Closing and evidence

- Backend: **746 passing, 91 skipped**, five existing warnings. Includes
  per-participant permissions, stale samples, cutoff at closing and a revoked session.
- Real Redis: **1 test passing** between two instances, with snapshot, order and TTL;
  it uses exclusive keys and neither restarts nor flushes Redis.
- Mobile: **429 passing**; GPS contracts, HTTP/WS cache, late permissions,
  service continuity, stages and guidance cancellation. TypeScript/lint/Ruff
  and OpenAPI/GPS contracts passing.
- UI: **12 scenarios passing**, taxi/moto, passenger/driver and three stages.
  Real screens with GPS/map doubles; it is not a validation of native cartography.
- Android: `assembleDebug` passed; regeneration and a second build passed (40 s).
  Signature verified. APK without `ACCESS_BACKGROUND_LOCATION`, with a visible
  `FOREGROUND_SERVICE_LOCATION` service during the ride; it stops at closing.
- Metro: full Android bundle of 12,091,433 bytes, with `transform.routerRoot=src/app`
  and `lazy=false`, checked including Navigation, GPS and signal recovery.
  The generic bundle without `routerRoot` only verifies the Expo runtime.
- Local artifacts: `local-files/driver-navigation-2026-09-19/`: APK, SHA-256 and UI.
  [Debug APK](../../local-files/driver-navigation-2026-09-19/viajaya-navigation-debug.apk).

**Current policy:** Development only. Testing is temporarily deprecated per
the user's instruction; no deliveries are built or deployed there. The plan and the
presentation move to revision 23. Automated tests continue.

**Installation on phones:** Development APK installed and main screen
verified on a Xiaomi 14T Pro (passenger) and a POCO F2 Pro (driver).

**Pending on phones:** confirm that the Navigation SDK
is enabled for the Development key/signature, test voice/Bluetooth, detours,
real moto coverage, permissions, locking and returning from Waze with the passenger on
another phone. No emulator was started.
F05/F06 keep their production closing pending; push and moving the app's own
map queries to the backend are not closed by this delivery either.

Commit `e10e6ae` stores the previous work. Navigation, tracking and the
plan update are recorded in a separate commit on the same branch;
no push was made.

## Fix after testing on Android

The user reported Waze working, Google navigation without good GPS
acquisition and the vehicle missing from the passenger's map. Fixed:

- Navigation registered the callback, but did not enable `startUpdatingLocation`
  after initializing the SDK. It now starts that subscription before waiting for
  GPS, shows the location with permission and stops it on exit. A failure before
  initializing does not try to stop a nonexistent navigator.
- Starting tracking only protected a session that was already
  sending. An event returning from the permissions dialog could replace the
  pending start. It now keeps that start and checks already granted
  permissions before opening a dialog. An available recent position is
  published without waiting for the first event of the continuous service.
- Fast Refresh also replaces the TaskManager callback, preventing it from
  keeping the previous context. Cancellation, accuracy and age
  validation and stopping when the ride closes are kept.
- The marker confused an unknown heading with an unknown vehicle: it hid
  the car/moto and left a dot. The vehicle keeps its drawing without orientation;
  the arrow only appears with a valid heading. Taxi/moto recover the type from the
  service when that data is missing from the profile.

Evidence: **442 mobile tests passing**, including 13 new regressions;
**15 location backend tests passing**, TypeScript and the official Expo lint
passing. Full Android bundle generated by Metro with these
fixes. No native changes and no need for another APK.

**Physical verification of this fix pending:** the POCO was suspended
with a permissions dialog and then lost its connection to the Metro debugger;
both phones were asked to stay open in the ride. Google GPS acquisition
and marker movement between phones are not certified yet.

References: [Expo Location 56](https://docs.expo.dev/versions/v56.0.0/sdk/location/),
[wrapper 0.16.3](https://github.com/googlemaps/react-native-navigation-sdk/tree/v0.16.3),
[Waze](https://developers.google.com/waze/deeplinks).
