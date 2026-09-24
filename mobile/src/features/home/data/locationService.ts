/**
 * Access to the device location (expo-location) behind a simple
 * port, to isolate the UI from the SDK and allow mocking it in tests.
 */
import * as Location from 'expo-location';

import type { Coordinates, PlaceLabel } from '@/core/domain/geo';
import { checkLocationAvailability, watchLocation } from './watchLocation';
import { isPlaceLabelResolved } from '@/features/booking/domain/placeLabels';
import {
  reverseGeocodeWithGoogle,
  type GeocodingQuality,
} from '@/features/home/data/googleGeocodingService';

export type { Coordinates, PlaceLabel } from '@/core/domain/geo';

export type LocationResult =
  | { status: 'granted'; coordinates: Coordinates; isEstimated: boolean }
  | { status: 'denied'; canAskAgain: boolean };

type GrantedLocationResult = Extract<LocationResult, { status: 'granted' }>;
type LocationUpdate = (result: GrantedLocationResult) => void;

function formatCoords({ latitude, longitude }: Coordinates): string {
  return `${latitude.toFixed(5)}, ${longitude.toFixed(5)}`;
}

// Google Plus Codes (e.g. "6R66+9P5"): alphanumeric block + '+' + suffix.
// We do not want them as a label; we prefer the street and number.
const PLUS_CODE_RE = /\b[A-Z0-9]{4,}\+[A-Z0-9]{2,}\b/i;
const UNNAMED_STREET_RE = /^(?:unnamed road|calle sin nombre|v[ií]a sin nombre|camino sin nombre)$/i;
const STREET_PREFIX_RE =
  /^(?:av(?:enida)?\.?|calle|c\.?|pasaje|pje\.?|ruta|carretera|anillo|camino)\b/i;

function clean(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed && !PLUS_CODE_RE.test(trimmed) && !UNNAMED_STREET_RE.test(trimmed)
    ? trimmed
    : null;
}

const LAST_LOCATION_MAX_AGE_MS = 2 * 60_000;
const LAST_LOCATION_REQUIRED_ACCURACY_METERS = 200;
const CURRENT_LOCATION_GRACE_MS = 1_200;
const LAST_LOCATION_TIMEOUT_MS = 800;
const CURRENT_LOCATION_TIMEOUT_MS = 10_000;
const GEOCODING_TIMEOUT_MS = 5_000;
const NATIVE_GEOCODING_GRACE_MS = 350;
const REFERENCE_CACHE_DURATION_MS = 15_000;
const MAX_GEOCODED_LABELS = 32;

type GeocodedLabel = {
  label: PlaceLabel;
  quality: GeocodingQuality;
};

type LabelCacheEntry = GeocodedLabel & { savedAt: number };

const geocodedLabels = new Map<string, LabelCacheEntry>();

class TimeoutExceededError extends Error {}

function withTimeLimit<T>(promise: Promise<T>, timeMs: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new TimeoutExceededError(message)),
      timeMs,
    );
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

function createLocationResult(
  position: Location.LocationObject,
  isEstimated: boolean,
): GrantedLocationResult {
  return {
    status: 'granted',
    coordinates: {
      latitude: position.coords.latitude,
      longitude: position.coords.longitude,
    },
    isEstimated,
  };
}

type CurrentPositionRequest = {
  startedAt: number;
  promise: Promise<Location.LocationObject>;
};

let currentPositionRequest: CurrentPositionRequest | null = null;

function getCurrentPosition(): Promise<Location.LocationObject> {
  if (
    currentPositionRequest &&
    Date.now() - currentPositionRequest.startedAt < CURRENT_LOCATION_TIMEOUT_MS
  ) {
    return currentPositionRequest.promise;
  }

  const promise = Location.getCurrentPositionAsync({
    accuracy: Location.Accuracy.Balanced,
  });
  const request = { startedAt: Date.now(), promise };
  currentPositionRequest = request;
  void promise.then(
    () => {
      if (currentPositionRequest === request) currentPositionRequest = null;
    },
    () => {
      if (currentPositionRequest === request) currentPositionRequest = null;
    },
  );
  return promise;
}

function publishPositionOnResolve(
  request: Promise<Location.LocationObject>,
  onUpdate: LocationUpdate | undefined,
): void {
  if (!onUpdate) return;
  void request
    .then((position) => onUpdate(createLocationResult(position, false)))
    .catch(() => undefined);
}

type GeocodingRequest = {
  coordinates: Coordinates;
  promise: Promise<Location.LocationGeocodedAddress[]>;
};

let geocodingRequest: GeocodingRequest | null = null;
let nativeGeocodingOperation: Promise<Location.LocationGeocodedAddress[]> | null = null;

function sameCoordinates(a: Coordinates, b: Coordinates): boolean {
  return (
    Math.abs(a.latitude - b.latitude) < 0.00001 &&
    Math.abs(a.longitude - b.longitude) < 0.00001
  );
}

function coordinateKey({ latitude, longitude }: Coordinates): string {
  return `${latitude.toFixed(5)},${longitude.toFixed(5)}`;
}

function getSavedLabel(
  coordinates: Coordinates,
  streetOnly = false,
): GeocodedLabel | null {
  const key = coordinateKey(coordinates);
  const entry = geocodedLabels.get(key);
  if (!entry) return null;
  if (streetOnly && entry.quality !== 'street') return null;
  if (
    entry.quality !== 'street' &&
    Date.now() - entry.savedAt >= REFERENCE_CACHE_DURATION_MS
  ) {
    geocodedLabels.delete(key);
    return null;
  }
  return { label: entry.label, quality: entry.quality };
}

function saveLabel(coordinates: Coordinates, result: GeocodedLabel): void {
  const key = coordinateKey(coordinates);
  geocodedLabels.delete(key);
  geocodedLabels.set(key, { ...result, savedAt: Date.now() });
  if (geocodedLabels.size <= MAX_GEOCODED_LABELS) return;
  const oldestKey = geocodedLabels.keys().next().value;
  if (oldestKey) geocodedLabels.delete(oldestKey);
}

function startGeocoding(
  coordinates: Coordinates,
): Promise<Location.LocationGeocodedAddress[]> {
  // The JavaScript timeout cannot cancel Android Geocoder. If the previous native
  // operation is still running, we use the HTTP fallback and avoid stacking calls.
  if (nativeGeocodingOperation) {
    return Promise.reject(
      new TimeoutExceededError('El geocoder nativo anterior sigue ocupado.'),
    );
  }
  const nativeOperation = Location.reverseGeocodeAsync(coordinates);
  nativeGeocodingOperation = nativeOperation;
  void nativeOperation.then(
    () => {
      if (nativeGeocodingOperation === nativeOperation) {
        nativeGeocodingOperation = null;
      }
    },
    () => {
      if (nativeGeocodingOperation === nativeOperation) {
        nativeGeocodingOperation = null;
      }
    },
  );
  const promise = withTimeLimit(
    nativeOperation,
    GEOCODING_TIMEOUT_MS,
    'La dirección tardó demasiado en resolverse.',
  );
  const request = { coordinates, promise };
  geocodingRequest = request;

  const finish = () => {
    if (geocodingRequest !== request) return;
    geocodingRequest = null;
  };
  void promise.then(
    finish,
    finish,
  );
  return promise;
}

function getGeocoding(
  coordinates: Coordinates,
): Promise<Location.LocationGeocodedAddress[]> {
  const active = geocodingRequest;
  if (!active) return startGeocoding(coordinates);

  if (sameCoordinates(active.coordinates, coordinates)) return active.promise;

  // A new coordinate never waits behind Android Geocoder: if the native one
  // is busy, resolverEtiqueta immediately starts the HTTP fallback.
  return Promise.reject(
    new TimeoutExceededError('El geocoder nativo está resolviendo otro punto.'),
  );
}

type ResolvedNativeLabel = {
  status: 'resolved';
  label: PlaceLabel;
  quality: GeocodingQuality;
};

type NativeLabelResult = ResolvedNativeLabel | { status: 'no_result' };

function createNativeLabel(
  result: Location.LocationGeocodedAddress | undefined,
  coordinates: Coordinates,
): ResolvedNativeLabel | null {
  if (!result) return null;

  const countryCode = clean(result.isoCountryCode)?.toUpperCase() ?? null;
  const nativeStreet = clean(result.street);
  const street =
    nativeStreet && !UNNAMED_STREET_RE.test(nativeStreet) ? nativeStreet : null;
  // Street + house number (if any): "Av. Perú 1500".
  const streetLine = street && result.streetNumber ? `${street} ${result.streetNumber}` : street;

  // Parts in priority order, without codes or duplicates.
  const formattedAddress =
    result.formattedAddress
      ?.split(',')
      .map(clean)
      .filter((part): part is string => Boolean(part))
      .join(', ') || null;
  const formattedName = formattedAddress?.split(',')[0]?.trim() || null;
  const formattedStreet =
    formattedName &&
    STREET_PREFIX_RE.test(formattedName) &&
    !UNNAMED_STREET_RE.test(formattedName)
      ? formattedName
      : null;
  const bestStreetLine = streetLine ?? formattedStreet;
  const nativeName = clean(result.name);
  const areaNames = [clean(result.district), clean(result.city), clean(result.region)].filter(
    (part): part is string => Boolean(part),
  );
  const ordered = [
    bestStreetLine,
    nativeName,
    formattedName,
    ...areaNames,
  ]
    .filter((part): part is string => Boolean(part))
    .filter((part, index, all) => all.indexOf(part) === index);
  if (ordered.length === 0) return null;

  const label = {
    name: ordered[0],
    address: formattedAddress ?? (ordered.slice(1).join(', ') || formatCoords(coordinates)),
    countryCode,
  };
  const quality: GeocodingQuality = bestStreetLine
    ? 'street'
    : nativeName && !areaNames.includes(nativeName)
      ? 'place'
      : 'area';
  return isPlaceLabelResolved(label)
    ? { status: 'resolved', label, quality }
    : null;
}

async function getNativeLabel(
  coordinates: Coordinates,
): Promise<NativeLabelResult> {
  try {
    const results = await getGeocoding(coordinates);
    const labels = results
      .map((result) => createNativeLabel(result, coordinates))
      .filter((result): result is ResolvedNativeLabel => result != null);
    return (
      labels.find((result) => result.quality === 'street') ??
      labels.find((result) => result.quality === 'place') ??
      labels[0] ?? { status: 'no_result' }
    );
  } catch {
    return { status: 'no_result' };
  }
}

function waitNativeGrace(
  request: Promise<NativeLabelResult>,
): Promise<NativeLabelResult | null> {
  return new Promise((resolve) => {
    let term = false;
    const timer = setTimeout(() => {
      term = true;
      resolve(null);
    }, NATIVE_GEOCODING_GRACE_MS);

    void request.then((result) => {
      if (term) return;
      term = true;
      clearTimeout(timer);
      resolve(result);
    });
  });
}

const QUALITY_SCORE: Record<GeocodingQuality, number> = {
  area: 1,
  place: 2,
  street: 3,
};

function chooseBestLabel(
  preferredOnTie: GeocodedLabel | null,
  alternative: GeocodedLabel | null,
): GeocodedLabel | null {
  if (!preferredOnTie) return alternative;
  if (!alternative) return preferredOnTie;
  return QUALITY_SCORE[alternative.quality] >
    QUALITY_SCORE[preferredOnTie.quality]
    ? alternative
    : preferredOnTie;
}

async function resolveLabel(
  coordinates: Coordinates,
): Promise<GeocodedLabel | null> {
  const nativeLookup = getNativeLabel(coordinates);
  const earlyResult = await waitNativeGrace(nativeLookup);

  // A native street is precise enough and avoids an HTTP call. A
  // neighborhood or city, instead, waits for Google because there may be a better
  // nearby street even though that generic reference arrived first.
  if (earlyResult?.status === 'resolved' && earlyResult.quality === 'street') {
    return { label: earlyResult.label, quality: earlyResult.quality };
  }

  const google = reverseGeocodeWithGoogle(coordinates).then((result) =>
    result && isPlaceLabelResolved(result.label) ? result : null,
  );

  if (earlyResult) {
    const googleOutcome = await google;
    const nativeOutcome =
      earlyResult.status === 'resolved'
        ? {
            label: earlyResult.label,
            quality: earlyResult.quality,
          }
        : null;
    return chooseBestLabel(googleOutcome, nativeOutcome);
  }

  // If both sources are still working, the first street wins. A generic
  // reference waits for the other source instead of hiding a slower street.
  const nativeCandidate = nativeLookup.then((result) =>
    result.status === 'resolved'
      ? { label: result.label, quality: result.quality }
      : null,
  );
  const nativeSource = nativeCandidate.then((result) => ({
    source: 'native' as const,
    result,
  }));
  const googleSource = google.then((result) => ({
    source: 'google' as const,
    result,
  }));
  const first = await Promise.race([nativeSource, googleSource]);
  if (first.result?.quality === 'street') return first.result;

  const second =
    first.source === 'native' ? await googleSource : await nativeSource;
  if (second.result?.quality === 'street') return second.result;

  const finalGoogle =
    first.source === 'google' ? first.result : second.result;
  const finalNative =
    first.source === 'native' ? first.result : second.result;
  return chooseBestLabel(finalGoogle, finalNative);
}

async function getGeocodedLabel(
  coordinates: Coordinates,
  streetOnly = false,
): Promise<GeocodedLabel | null> {
  const cached = getSavedLabel(coordinates, streetOnly);
  if (cached) return cached;

  const result = await resolveLabel(coordinates);
  if (!result || !isPlaceLabelResolved(result.label)) return null;
  saveLabel(coordinates, result);
  return result;
}

export const locationService = {
  /**
   * Request the while-in-use location permission and return the current position.
   * If the user denies it, returns `{ status: 'denied' }` (without throwing).
   */
  async getCurrentLocation(onUpdate?: LocationUpdate): Promise<LocationResult> {
    const permission = await Location.requestForegroundPermissionsAsync();
    if (permission.status !== Location.PermissionStatus.GRANTED) {
      return { status: 'denied', canAskAgain: permission.canAskAgain };
    }

    // A fresh position can take a long time indoors or on devices
    // with slow GPS. We first query the native cache, which does not wake the sensors.
    const lastKnownPosition = await withTimeLimit(
      Location.getLastKnownPositionAsync({
        maxAge: LAST_LOCATION_MAX_AGE_MS,
        requiredAccuracy: LAST_LOCATION_REQUIRED_ACCURACY_METERS,
      }),
      LAST_LOCATION_TIMEOUT_MS,
      'La última ubicación tardó demasiado.',
    ).catch(() => null);
    const currentPositionPromise = getCurrentPosition();

    // We prefer the fresh position. If it is slow, the last position is only
    // provisional and the shared native promise will update the cache when it resolves.
    if (lastKnownPosition) {
      try {
        const position = await withTimeLimit(
          currentPositionPromise,
          CURRENT_LOCATION_GRACE_MS,
          'La ubicación actual todavía no está disponible.',
        );
        return createLocationResult(position, false);
      } catch (error: unknown) {
        if (error instanceof TimeoutExceededError) {
          publishPositionOnResolve(currentPositionPromise, onUpdate);
        }
        return createLocationResult(lastKnownPosition, true);
      }
    }

    try {
      const position = await withTimeLimit(
        currentPositionPromise,
        CURRENT_LOCATION_TIMEOUT_MS,
        'La ubicación actual tardó demasiado.',
      );
      return createLocationResult(position, false);
    } catch (error: unknown) {
      if (error instanceof TimeoutExceededError) {
        publishPositionOnResolve(currentPositionPromise, onUpdate);
      }
      throw error;
    }
  },

  /** A fresh fix for pickup routing; never use the provisional last-known fix. */
  async getRoutingCoordinates(): Promise<Coordinates> {
    const permission = await Location.requestForegroundPermissionsAsync();
    if (permission.status !== 'granted') {
      throw new Error('Permite el acceso a tu ubicación para calcular la llegada.');
    }
    if (!await Location.hasServicesEnabledAsync()) {
      throw new Error('Activa la ubicación del teléfono para calcular la llegada.');
    }
    const position = await withTimeLimit(getCurrentPosition().catch(() => {
      throw new Error('No pudimos obtener tu ubicación actual. Intenta de nuevo.');
    }), 10_000,
      'No pudimos obtener tu ubicación actual. Intenta de nuevo.');
    if (!Number.isFinite(position.timestamp) || Date.now() - position.timestamp > 30_000
      || position.coords.accuracy == null || !Number.isFinite(position.coords.accuracy)
      || position.coords.accuracy < 0 || position.coords.accuracy > 200) {
      throw new Error('Tu señal de ubicación todavía es imprecisa. Intenta de nuevo.');
    }
    return createLocationResult(position, false).coordinates;
  },

  /** Driver tracking: GPS and compass, with joint cancellation. */
  watchPosition: watchLocation,
  checkAvailability: checkLocationAvailability,

  /**
   * Reverse geocoding: turns coordinates into a readable label.
   *
   * Returns a literal shape — **street and number** as `name`, and the rest
   * (neighborhood/city) as `address` — ignoring Plus Codes and other codes.
   * A failure is expressed as `null`; it never becomes a fake label.
   */
  async reverseGeocode(coordinates: Coordinates): Promise<PlaceLabel | null> {
    const result = await getGeocodedLabel(coordinates);
    return result?.label ?? null;
  },

  /** Return only a nearby street; a POI, neighborhood or city is not enough. */
  async reverseGeocodeNearestStreet(coordinates: Coordinates): Promise<PlaceLabel | null> {
    const result = await getGeocodedLabel(coordinates, true);
    return result?.quality === 'street' ? result.label : null;
  },
};
