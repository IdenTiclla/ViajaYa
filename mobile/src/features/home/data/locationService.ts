/**
 * Access to the device location (expo-location) behind a simple
 * port, to isolate the UI from the SDK and allow mocking it in tests.
 */
import * as Location from 'expo-location';

import type { Coordinates, PlaceLabel } from '@/core/domain/geo';
import { consultarDisponibilidadUbicacion, observarUbicacion } from './observarUbicacion';
import { isPlaceLabelResolved } from '@/features/booking/domain/placeLabels';
import {
  reverseGeocodeWithGoogle,
  type CalidadGeocodificacion,
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
const CALLE_SIN_NOMBRE_RE = /^(?:unnamed road|calle sin nombre|v[ií]a sin nombre|camino sin nombre)$/i;
const PREFIJO_CALLE_RE =
  /^(?:av(?:enida)?\.?|calle|c\.?|pasaje|pje\.?|ruta|carretera|anillo|camino)\b/i;

function clean(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed && !PLUS_CODE_RE.test(trimmed) && !CALLE_SIN_NOMBRE_RE.test(trimmed)
    ? trimmed
    : null;
}

const EDAD_MAXIMA_ULTIMA_UBICACION_MS = 2 * 60_000;
const PRECISION_REQUERIDA_ULTIMA_UBICACION_METROS = 200;
const GRACIA_UBICACION_ACTUAL_MS = 1_200;
const TIEMPO_MAXIMO_ULTIMA_UBICACION_MS = 800;
const TIEMPO_MAXIMO_UBICACION_ACTUAL_MS = 10_000;
const TIEMPO_MAXIMO_GEOCODIFICACION_MS = 5_000;
const GRACIA_GEOCODIFICACION_NATIVA_MS = 350;
const DURACION_CACHE_REFERENCIA_MS = 15_000;
const MAX_ETIQUETAS_GEOCODIFICADAS = 32;

type EtiquetaGeocodificada = {
  etiqueta: PlaceLabel;
  calidad: CalidadGeocodificacion;
};

type EntradaCacheEtiqueta = EtiquetaGeocodificada & { guardadaEn: number };

const etiquetasGeocodificadas = new Map<string, EntradaCacheEtiqueta>();

class TiempoMaximoSuperadoError extends Error {}

function conTiempoMaximo<T>(promise: Promise<T>, tiempoMs: number, mensaje: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const temporizador = setTimeout(
      () => reject(new TiempoMaximoSuperadoError(mensaje)),
      tiempoMs,
    );
    promise.then(
      (value) => {
        clearTimeout(temporizador);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(temporizador);
        reject(error);
      },
    );
  });
}

function crearResultadoUbicacion(
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

type SolicitudPosicionActual = {
  iniciadaEn: number;
  promise: Promise<Location.LocationObject>;
};

let solicitudPosicionActual: SolicitudPosicionActual | null = null;

function obtenerPosicionActual(): Promise<Location.LocationObject> {
  if (
    solicitudPosicionActual &&
    Date.now() - solicitudPosicionActual.iniciadaEn < TIEMPO_MAXIMO_UBICACION_ACTUAL_MS
  ) {
    return solicitudPosicionActual.promise;
  }

  const promise = Location.getCurrentPositionAsync({
    accuracy: Location.Accuracy.Balanced,
  });
  const solicitud = { iniciadaEn: Date.now(), promise };
  solicitudPosicionActual = solicitud;
  void promise.then(
    () => {
      if (solicitudPosicionActual === solicitud) solicitudPosicionActual = null;
    },
    () => {
      if (solicitudPosicionActual === solicitud) solicitudPosicionActual = null;
    },
  );
  return promise;
}

function publicarPosicionAlResolver(
  solicitud: Promise<Location.LocationObject>,
  onUpdate: LocationUpdate | undefined,
): void {
  if (!onUpdate) return;
  void solicitud
    .then((position) => onUpdate(crearResultadoUbicacion(position, false)))
    .catch(() => undefined);
}

type SolicitudGeocodificacion = {
  coordinates: Coordinates;
  promise: Promise<Location.LocationGeocodedAddress[]>;
};

let solicitudGeocodificacion: SolicitudGeocodificacion | null = null;
let operacionGeocodificacionNativa: Promise<Location.LocationGeocodedAddress[]> | null = null;

function mismasCoordenadas(a: Coordinates, b: Coordinates): boolean {
  return (
    Math.abs(a.latitude - b.latitude) < 0.00001 &&
    Math.abs(a.longitude - b.longitude) < 0.00001
  );
}

function claveCoordenadas({ latitude, longitude }: Coordinates): string {
  return `${latitude.toFixed(5)},${longitude.toFixed(5)}`;
}

function obtenerEtiquetaGuardada(
  coordinates: Coordinates,
  soloCalle = false,
): EtiquetaGeocodificada | null {
  const key = claveCoordenadas(coordinates);
  const entrada = etiquetasGeocodificadas.get(key);
  if (!entrada) return null;
  if (soloCalle && entrada.calidad !== 'calle') return null;
  if (
    entrada.calidad !== 'calle' &&
    Date.now() - entrada.guardadaEn >= DURACION_CACHE_REFERENCIA_MS
  ) {
    etiquetasGeocodificadas.delete(key);
    return null;
  }
  return { etiqueta: entrada.etiqueta, calidad: entrada.calidad };
}

function guardarEtiqueta(coordinates: Coordinates, resultado: EtiquetaGeocodificada): void {
  const key = claveCoordenadas(coordinates);
  etiquetasGeocodificadas.delete(key);
  etiquetasGeocodificadas.set(key, { ...resultado, guardadaEn: Date.now() });
  if (etiquetasGeocodificadas.size <= MAX_ETIQUETAS_GEOCODIFICADAS) return;
  const oldestKey = etiquetasGeocodificadas.keys().next().value;
  if (oldestKey) etiquetasGeocodificadas.delete(oldestKey);
}

function iniciarGeocodificacion(
  coordinates: Coordinates,
): Promise<Location.LocationGeocodedAddress[]> {
  // The JavaScript timeout cannot cancel Android Geocoder. If the previous native
  // operation is still running, we use the HTTP fallback and avoid stacking calls.
  if (operacionGeocodificacionNativa) {
    return Promise.reject(
      new TiempoMaximoSuperadoError('El geocoder nativo anterior sigue ocupado.'),
    );
  }
  const operacionNativa = Location.reverseGeocodeAsync(coordinates);
  operacionGeocodificacionNativa = operacionNativa;
  void operacionNativa.then(
    () => {
      if (operacionGeocodificacionNativa === operacionNativa) {
        operacionGeocodificacionNativa = null;
      }
    },
    () => {
      if (operacionGeocodificacionNativa === operacionNativa) {
        operacionGeocodificacionNativa = null;
      }
    },
  );
  const promise = conTiempoMaximo(
    operacionNativa,
    TIEMPO_MAXIMO_GEOCODIFICACION_MS,
    'La dirección tardó demasiado en resolverse.',
  );
  const solicitud = { coordinates, promise };
  solicitudGeocodificacion = solicitud;

  const finalizar = () => {
    if (solicitudGeocodificacion !== solicitud) return;
    solicitudGeocodificacion = null;
  };
  void promise.then(
    finalizar,
    finalizar,
  );
  return promise;
}

function obtenerGeocodificacion(
  coordinates: Coordinates,
): Promise<Location.LocationGeocodedAddress[]> {
  const activa = solicitudGeocodificacion;
  if (!activa) return iniciarGeocodificacion(coordinates);

  if (mismasCoordenadas(activa.coordinates, coordinates)) return activa.promise;

  // A new coordinate never waits behind Android Geocoder: if the native one
  // is busy, resolverEtiqueta immediately starts the HTTP fallback.
  return Promise.reject(
    new TiempoMaximoSuperadoError('El geocoder nativo está resolviendo otro punto.'),
  );
}

type EtiquetaNativaResuelta = {
  estado: 'resuelta';
  etiqueta: PlaceLabel;
  calidad: CalidadGeocodificacion;
};

type ResultadoEtiquetaNativa = EtiquetaNativaResuelta | { estado: 'sin_resultado' };

function crearEtiquetaNativa(
  result: Location.LocationGeocodedAddress | undefined,
  coordinates: Coordinates,
): EtiquetaNativaResuelta | null {
  if (!result) return null;

  const countryCode = clean(result.isoCountryCode)?.toUpperCase() ?? null;
  const nativeStreet = clean(result.street);
  const street =
    nativeStreet && !CALLE_SIN_NOMBRE_RE.test(nativeStreet) ? nativeStreet : null;
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
    PREFIJO_CALLE_RE.test(formattedName) &&
    !CALLE_SIN_NOMBRE_RE.test(formattedName)
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
  const calidad: CalidadGeocodificacion = bestStreetLine
    ? 'calle'
    : nativeName && !areaNames.includes(nativeName)
      ? 'lugar'
      : 'area';
  return isPlaceLabelResolved(label)
    ? { estado: 'resuelta', etiqueta: label, calidad }
    : null;
}

async function obtenerEtiquetaNativa(
  coordinates: Coordinates,
): Promise<ResultadoEtiquetaNativa> {
  try {
    const resultados = await obtenerGeocodificacion(coordinates);
    const etiquetas = resultados
      .map((resultado) => crearEtiquetaNativa(resultado, coordinates))
      .filter((resultado): resultado is EtiquetaNativaResuelta => resultado != null);
    return (
      etiquetas.find((resultado) => resultado.calidad === 'calle') ??
      etiquetas.find((resultado) => resultado.calidad === 'lugar') ??
      etiquetas[0] ?? { estado: 'sin_resultado' }
    );
  } catch {
    return { estado: 'sin_resultado' };
  }
}

function esperarGraciaNativa(
  solicitud: Promise<ResultadoEtiquetaNativa>,
): Promise<ResultadoEtiquetaNativa | null> {
  return new Promise((resolve) => {
    let termino = false;
    const temporizador = setTimeout(() => {
      termino = true;
      resolve(null);
    }, GRACIA_GEOCODIFICACION_NATIVA_MS);

    void solicitud.then((resultado) => {
      if (termino) return;
      termino = true;
      clearTimeout(temporizador);
      resolve(resultado);
    });
  });
}

const PUNTUACION_CALIDAD: Record<CalidadGeocodificacion, number> = {
  area: 1,
  lugar: 2,
  calle: 3,
};

function elegirMejorEtiqueta(
  preferidaEnEmpate: EtiquetaGeocodificada | null,
  alternativa: EtiquetaGeocodificada | null,
): EtiquetaGeocodificada | null {
  if (!preferidaEnEmpate) return alternativa;
  if (!alternativa) return preferidaEnEmpate;
  return PUNTUACION_CALIDAD[alternativa.calidad] >
    PUNTUACION_CALIDAD[preferidaEnEmpate.calidad]
    ? alternativa
    : preferidaEnEmpate;
}

async function resolverEtiqueta(
  coordinates: Coordinates,
): Promise<EtiquetaGeocodificada | null> {
  const nativa = obtenerEtiquetaNativa(coordinates);
  const resultadoTemprano = await esperarGraciaNativa(nativa);

  // A native street is precise enough and avoids an HTTP call. A
  // neighborhood or city, instead, waits for Google because there may be a better
  // nearby street even though that generic reference arrived first.
  if (resultadoTemprano?.estado === 'resuelta' && resultadoTemprano.calidad === 'calle') {
    return { etiqueta: resultadoTemprano.etiqueta, calidad: resultadoTemprano.calidad };
  }

  const google = reverseGeocodeWithGoogle(coordinates).then((resultado) =>
    resultado && isPlaceLabelResolved(resultado.etiqueta) ? resultado : null,
  );

  if (resultadoTemprano) {
    const resultadoGoogle = await google;
    const resultadoNativo =
      resultadoTemprano.estado === 'resuelta'
        ? {
            etiqueta: resultadoTemprano.etiqueta,
            calidad: resultadoTemprano.calidad,
          }
        : null;
    return elegirMejorEtiqueta(resultadoGoogle, resultadoNativo);
  }

  // If both sources are still working, the first street wins. A generic
  // reference waits for the other source instead of hiding a slower street.
  const candidataNativa = nativa.then((resultado) =>
    resultado.estado === 'resuelta'
      ? { etiqueta: resultado.etiqueta, calidad: resultado.calidad }
      : null,
  );
  const fuenteNativa = candidataNativa.then((resultado) => ({
    fuente: 'nativa' as const,
    resultado,
  }));
  const fuenteGoogle = google.then((resultado) => ({
    fuente: 'google' as const,
    resultado,
  }));
  const primero = await Promise.race([fuenteNativa, fuenteGoogle]);
  if (primero.resultado?.calidad === 'calle') return primero.resultado;

  const segundo =
    primero.fuente === 'nativa' ? await fuenteGoogle : await fuenteNativa;
  if (segundo.resultado?.calidad === 'calle') return segundo.resultado;

  const resultadoGoogle =
    primero.fuente === 'google' ? primero.resultado : segundo.resultado;
  const resultadoNativo =
    primero.fuente === 'nativa' ? primero.resultado : segundo.resultado;
  return elegirMejorEtiqueta(resultadoGoogle, resultadoNativo);
}

async function obtenerEtiquetaGeocodificada(
  coordinates: Coordinates,
  soloCalle = false,
): Promise<EtiquetaGeocodificada | null> {
  const cached = obtenerEtiquetaGuardada(coordinates, soloCalle);
  if (cached) return cached;

  const resultado = await resolverEtiqueta(coordinates);
  if (!resultado || !isPlaceLabelResolved(resultado.etiqueta)) return null;
  guardarEtiqueta(coordinates, resultado);
  return resultado;
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
    const lastKnownPosition = await conTiempoMaximo(
      Location.getLastKnownPositionAsync({
        maxAge: EDAD_MAXIMA_ULTIMA_UBICACION_MS,
        requiredAccuracy: PRECISION_REQUERIDA_ULTIMA_UBICACION_METROS,
      }),
      TIEMPO_MAXIMO_ULTIMA_UBICACION_MS,
      'La última ubicación tardó demasiado.',
    ).catch(() => null);
    const currentPositionPromise = obtenerPosicionActual();

    // We prefer the fresh position. If it is slow, the last position is only
    // provisional and the shared native promise will update the cache when it resolves.
    if (lastKnownPosition) {
      try {
        const position = await conTiempoMaximo(
          currentPositionPromise,
          GRACIA_UBICACION_ACTUAL_MS,
          'La ubicación actual todavía no está disponible.',
        );
        return crearResultadoUbicacion(position, false);
      } catch (error: unknown) {
        if (error instanceof TiempoMaximoSuperadoError) {
          publicarPosicionAlResolver(currentPositionPromise, onUpdate);
        }
        return crearResultadoUbicacion(lastKnownPosition, true);
      }
    }

    try {
      const position = await conTiempoMaximo(
        currentPositionPromise,
        TIEMPO_MAXIMO_UBICACION_ACTUAL_MS,
        'La ubicación actual tardó demasiado.',
      );
      return crearResultadoUbicacion(position, false);
    } catch (error: unknown) {
      if (error instanceof TiempoMaximoSuperadoError) {
        publicarPosicionAlResolver(currentPositionPromise, onUpdate);
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
    const position = await conTiempoMaximo(obtenerPosicionActual().catch(() => {
      throw new Error('No pudimos obtener tu ubicación actual. Intenta de nuevo.');
    }), 10_000,
      'No pudimos obtener tu ubicación actual. Intenta de nuevo.');
    if (!Number.isFinite(position.timestamp) || Date.now() - position.timestamp > 30_000
      || position.coords.accuracy == null || !Number.isFinite(position.coords.accuracy)
      || position.coords.accuracy < 0 || position.coords.accuracy > 200) {
      throw new Error('Tu señal de ubicación todavía es imprecisa. Intenta de nuevo.');
    }
    return crearResultadoUbicacion(position, false).coordinates;
  },

  /** Driver tracking: GPS and compass, with joint cancellation. */
  watchPosition: observarUbicacion,
  consultarDisponibilidad: consultarDisponibilidadUbicacion,

  /**
   * Reverse geocoding: turns coordinates into a readable label.
   *
   * Returns a literal shape — **street and number** as `name`, and the rest
   * (neighborhood/city) as `address` — ignoring Plus Codes and other codes.
   * A failure is expressed as `null`; it never becomes a fake label.
   */
  async reverseGeocode(coordinates: Coordinates): Promise<PlaceLabel | null> {
    const resultado = await obtenerEtiquetaGeocodificada(coordinates);
    return resultado?.etiqueta ?? null;
  },

  /** Return only a nearby street; a POI, neighborhood or city is not enough. */
  async reverseGeocodeNearestStreet(coordinates: Coordinates): Promise<PlaceLabel | null> {
    const resultado = await obtenerEtiquetaGeocodificada(coordinates, true);
    return resultado?.calidad === 'calle' ? resultado.etiqueta : null;
  },
};
