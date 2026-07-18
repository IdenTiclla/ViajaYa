/**
 * Acceso a la ubicación del dispositivo (expo-location) detrás de un puerto
 * sencillo, para aislar la UI del SDK y poder mockearlo en tests.
 */
import * as Location from 'expo-location';

import { isPlaceLabelResolved } from '@/features/booking/domain/placeLabels';
import {
  reverseGeocodeWithGoogle,
  type CalidadGeocodificacion,
} from '@/features/home/data/googleGeocodingService';

export type Coordinates = { latitude: number; longitude: number };

export type LocationResult =
  | { status: 'granted'; coordinates: Coordinates; isEstimated: boolean }
  | { status: 'denied'; canAskAgain: boolean };

type GrantedLocationResult = Extract<LocationResult, { status: 'granted' }>;
type LocationUpdate = (result: GrantedLocationResult) => void;

/** Etiqueta legible de un punto: nombre corto + dirección secundaria. */
export type PlaceLabel = { name: string; address: string; countryCode: string | null };

function formatCoords({ latitude, longitude }: Coordinates): string {
  return `${latitude.toFixed(5)}, ${longitude.toFixed(5)}`;
}

// Plus Codes de Google (p. ej. "6R66+9P5"): bloque alfanumérico + '+' + sufijo.
// No los queremos como etiqueta; preferimos la calle y el número.
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
  // El timeout de JavaScript no puede cancelar Android Geocoder. Si la operación
  // nativa anterior sigue viva, usamos el respaldo HTTP y evitamos apilar llamadas.
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

  // Una coordenada nueva nunca espera detrás de Android Geocoder: si el nativo
  // está ocupado, resolverEtiqueta inicia inmediatamente el respaldo HTTP.
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
  // Calle + número de casa (si lo hay): "Av. Perú 1500".
  const streetLine = street && result.streetNumber ? `${street} ${result.streetNumber}` : street;

  // Partes en orden de prioridad, sin códigos ni duplicados.
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

  // Una calle nativa es suficientemente precisa y evita una llamada HTTP. Un
  // barrio o ciudad, en cambio, espera a Google porque puede existir una vía
  // cercana mejor aunque esa referencia genérica haya llegado primero.
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

  // Si ambas fuentes siguen trabajando, la primera calle gana. Una referencia
  // genérica espera a la otra fuente en vez de ocultar una calle más lenta.
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
   * Solicita el permiso de ubicación en uso y devuelve la posición actual.
   * Si el usuario lo deniega, regresa `{ status: 'denied' }` (sin lanzar).
   */
  async getCurrentLocation(onUpdate?: LocationUpdate): Promise<LocationResult> {
    const permission = await Location.requestForegroundPermissionsAsync();
    if (permission.status !== Location.PermissionStatus.GRANTED) {
      return { status: 'denied', canAskAgain: permission.canAskAgain };
    }

    // Una posición fresca puede tardar mucho dentro de edificios o en equipos
    // con GPS lento. Primero consultamos la caché nativa, que no activa sensores.
    const lastKnownPosition = await conTiempoMaximo(
      Location.getLastKnownPositionAsync({
        maxAge: EDAD_MAXIMA_ULTIMA_UBICACION_MS,
        requiredAccuracy: PRECISION_REQUERIDA_ULTIMA_UBICACION_METROS,
      }),
      TIEMPO_MAXIMO_ULTIMA_UBICACION_MS,
      'La última ubicación tardó demasiado.',
    ).catch(() => null);
    const currentPositionPromise = obtenerPosicionActual();

    // Preferimos la posición fresca. Si tarda, la última posición solo es
    // provisional y la promesa nativa compartida actualizará la caché al resolver.
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

  /**
   * Suscribe a la ubicación en movimiento del dispositivo (para navegación del
   * conductor). Devuelve una suscripción con `remove()` (o ``null`` si el permiso
   * fue denegado). Llama al callback con cada nueva posición y su rumbo
   * (`heading` en grados, o ``null`` si no está disponible).
   */
  async watchPosition(
    callback: (coordinates: Coordinates, heading: number | null) => void,
  ): Promise<{ remove: () => void } | null> {
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== Location.PermissionStatus.GRANTED) {
      return null;
    }

    const subscription = await Location.watchPositionAsync(
      { accuracy: Location.Accuracy.High, timeInterval: 2000, distanceInterval: 3 },
      (loc) => {
        const heading = loc.coords.heading;
        callback(
          { latitude: loc.coords.latitude, longitude: loc.coords.longitude },
          heading != null && heading >= 0 ? heading : null,
        );
      },
    );
    return subscription;
  },

  /**
   * Geocodificación inversa: convierte coordenadas en una etiqueta legible.
   *
   * Devuelve una forma literal — **calle y número** como `name`, y el resto
   * (barrio/ciudad) como `address` — ignorando Plus Codes y otros códigos.
   * Un fallo se expresa como `null`; nunca se convierte en una etiqueta ficticia.
   */
  async reverseGeocode(coordinates: Coordinates): Promise<PlaceLabel | null> {
    const resultado = await obtenerEtiquetaGeocodificada(coordinates);
    return resultado?.etiqueta ?? null;
  },

  /** Devuelve únicamente una vía cercana; un POI, barrio o ciudad no basta. */
  async reverseGeocodeNearestStreet(coordinates: Coordinates): Promise<PlaceLabel | null> {
    const resultado = await obtenerEtiquetaGeocodificada(coordinates, true);
    return resultado?.calidad === 'calle' ? resultado.etiqueta : null;
  },
};
