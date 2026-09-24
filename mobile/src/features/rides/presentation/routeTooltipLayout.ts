import type { Coordinates } from '@/core/domain/geo';

export type PosicionTooltip = 'arriba' | 'abajo';
// A single visual scale for every map, with no variants per role or screen.
// Logical sizes: react-native-maps applies each device's native density.
export const ANCHO_RUTA = 3;
export const ANCHO_CONTORNO_RUTA = 5;
export const TAMANO_PIN_RUTA = 16;
export const BORDE_PIN_RUTA = 1.5;
export const TAMANO_LETRA_PIN_RUTA = 9;
export const MARGEN_TOOLTIP_RUTA = 96;
export const MARGEN_TOOLTIP_EDITABLE = 126;
export const SEPARACION_TOOLTIP = 8;
const SEPARACION_MAXIMA_TOOLTIP = 48;
const HOLGURA_RUTA = ANCHO_CONTORNO_RUTA / 2 + 4;

export type PuntoMapa = { x: number; y: number };
export type MedidasEtiqueta = { ancho: number; alto: number };

/**
 * Web Mercator in world units (the whole world spans 1 × 1). Shared by label
 * placement and camera framing so both agree on the screen geometry.
 */
export function mercatorY(latitude: number): number {
  const radians = Math.max(-85, Math.min(85, latitude)) * Math.PI / 180;
  return Math.log(Math.tan(Math.PI / 4 + radians / 2)) / (2 * Math.PI);
}

export function latitudeFromMercatorY(y: number): number {
  return (2 * Math.atan(Math.exp(y * 2 * Math.PI)) - Math.PI / 2) * 180 / Math.PI;
}

/** Signed longitude difference in degrees, wrapped across the antimeridian. */
export function longitudeDelta(from: number, to: number): number {
  return ((to - from + 540) % 360) - 180;
}

/** Top-down Google Maps projection in logical units, relative to the pin. */
export function proyectarRutaRespectoAlPin(
  punto: Coordinates,
  ruta: readonly Coordinates[],
  rumboMapa: number,
  zoomMapa: number,
): PuntoMapa[] {
  const escala = 256 * 2 ** zoomMapa;
  const origenY = mercatorY(punto.latitude);
  const rumbo = rumboMapa * Math.PI / 180;
  return ruta.map((coordenada) => {
    const este = longitudeDelta(punto.longitude, coordenada.longitude) / 360 * escala;
    const norte = (mercatorY(coordenada.latitude) - origenY) * escala;
    return {
      x: este * Math.cos(rumbo) - norte * Math.sin(rumbo),
      y: -norte * Math.cos(rumbo) - este * Math.sin(rumbo),
    };
  });
}

/** Find room for the whole label, including Editar, in front of every segment. */
export function ubicarTooltipSinCruzarRuta(
  ruta: readonly PuntoMapa[],
  medidas: MedidasEtiqueta,
  preferida: PosicionTooltip,
): { posicion: PosicionTooltip; separacion: number; visible: boolean } {
  const radio = TAMANO_PIN_RUTA / 2;
  const limiteX = medidas.ancho / 2 + HOLGURA_RUTA;
  const ocupados: [number, number][] = [];
  for (let i = 1; i < ruta.length; i += 1) {
    const a = ruta[i - 1];
    const b = ruta[i];
    // Clip the segment against the tooltip's horizontal band: checking
    // only vertices would miss a long street crossing behind the text.
    const dx = b.x - a.x;
    let inicio = 0;
    let fin = 1;
    if (Math.abs(dx) < 0.000001) {
      if (Math.abs(a.x) > limiteX) continue;
    } else {
      const t1 = (-limiteX - a.x) / dx;
      const t2 = (limiteX - a.x) / dx;
      inicio = Math.max(0, Math.min(t1, t2));
      fin = Math.min(1, Math.max(t1, t2));
      if (inicio > fin) continue;
    }
    const y1 = a.y + (b.y - a.y) * inicio;
    const y2 = a.y + (b.y - a.y) * fin;
    ocupados.push([Math.min(y1, y2) - HOLGURA_RUTA, Math.max(y1, y2) + HOLGURA_RUTA]);
  }

  const separacionLibre = (posicion: PosicionTooltip) => {
    const intervalos = ocupados.map(([min, max]): [number, number] =>
      posicion === 'arriba' ? [-max, -min] : [min, max],
    ).sort((a, b) => a[0] - b[0]);
    let borde = radio + SEPARACION_TOOLTIP;
    for (const [inicio, fin] of intervalos) {
      if (fin < borde) continue;
      if (inicio > borde + medidas.alto) break;
      borde = fin + 1;
    }
    return borde - radio;
  };
  const opuesta = preferida === 'arriba' ? 'abajo' : 'arriba';
  const principal = separacionLibre(preferida);
  const alternativa = separacionLibre(opuesta);
  const posicion = principal <= alternativa ? preferida : opuesta;
  const separacion = Math.min(principal, alternativa);
  // At a zoom that is too far out no label may fit. We prioritize
  // the route and keep its native title available when tapping A/B; we never create
  // a giant bitmap nor place text over the route as a fallback.
  return separacion <= SEPARACION_MAXIMA_TOOLTIP
    ? { posicion, separacion, visible: true }
    : { posicion: preferida, separacion: SEPARACION_TOOLTIP, visible: false };
}

/** Place the text on the side opposite the segment entering or leaving the point. */
export function elegirPosicionTooltip(
  kind: 'A' | 'B',
  punto: Coordinates,
  ruta: readonly Coordinates[],
  rumboMapa = 0,
): PosicionTooltip {
  const preferida = kind === 'A' ? 'arriba' : 'abajo';
  const cosLatitud = Math.cos(punto.latitude * Math.PI / 180);
  const rumbo = rumboMapa * Math.PI / 180;
  let este = 0;
  let norte = 0;
  // Skip duplicates and the provider's small snap to the street. Using the
  // opposite end would fail on routes that first turn in another direction.
  for (let i = 0; i < ruta.length; i += 1) {
    const vecino = ruta[kind === 'A' ? i : ruta.length - 1 - i];
    este = (vecino.longitude - punto.longitude) * cosLatitud;
    norte = vecino.latitude - punto.latitude;
    if (Math.hypot(este, norte) >= 0.0001) break;
  }
  const longitud = Math.hypot(este, norte);
  if (longitud === 0) return preferida;
  // The camera bearing also counts: after rotating the map, geographic north
  // no longer matches the top of the screen. A horizontal segment uses each letter's
  // stable side so labels do not flip due to rounding.
  const haciaArriba = norte * Math.cos(rumbo) + este * Math.sin(rumbo);
  if (Math.abs(haciaArriba) < longitud * 0.1) return preferida;
  return haciaArriba > 0 ? 'abajo' : 'arriba';
}

/** Keep the symbol's center on the coordinate, even with several lines. */
export function calcularAnclajePin(altura: number, posicion: PosicionTooltip) {
  const alturaReal = Math.max(altura, TAMANO_PIN_RUTA);
  const centroPin = posicion === 'arriba'
    ? alturaReal - TAMANO_PIN_RUTA / 2
    : TAMANO_PIN_RUTA / 2;
  return { x: 0.5, y: centroPin / alturaReal };
}

/** Give the native layout room before regenerating the Google Maps bitmap. */
export function programarRedibujadoMarcador(
  redibujar: () => void,
  pedirFrame = requestAnimationFrame,
  cancelarFrame = cancelAnimationFrame,
): () => void {
  let cancelado = false;
  let frame = pedirFrame(() => {
    if (cancelado) return;
    frame = pedirFrame(() => {
      if (!cancelado) redibujar();
    });
  });
  return () => {
    cancelado = true;
    cancelarFrame(frame);
  };
}

export type RoutePinLabel = {
  kind: 'A' | 'B';
  coordinate: Coordinates;
  /** Measured label block (RoutePinMarker reports it), in logical pixels. */
  size: MedidasEtiqueta;
};

type EdgePadding = { top: number; bottom: number; left: number; right: number };

/**
 * Extra points so `fitToCoordinates` frames the route *and* its A/B labels on a
 * north-up map. Each label is placed with the same rules RoutePinMarker uses
 * (side, separation and visibility depend on the zoom), so the scale is refined
 * until the labels' outer corners fit the padded viewport.
 */
export function getLabelAwareFitCoordinates(
  route: readonly Coordinates[],
  labels: readonly RoutePinLabel[],
  width: number,
  height: number,
  padding: EdgePadding,
): Coordinates[] {
  const innerWidth = width - padding.left - padding.right;
  const innerHeight = height - padding.top - padding.bottom;
  if (route.length < 2 || labels.length === 0 || innerWidth <= 0 || innerHeight <= 0) {
    return [...route];
  }

  // World units relative to the first point; route bounds never change.
  const ref = route[0].longitude;
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const point of route) {
    const x = longitudeDelta(ref, point.longitude) / 360;
    const y = mercatorY(point.latitude);
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  }
  if (maxX - minX <= 0 && maxY - minY <= 0) return [...route];

  const pins = labels.map((label) => ({
    ...label,
    x: longitudeDelta(ref, label.coordinate.longitude) / 360,
    y: mercatorY(label.coordinate.latitude),
    preferred: elegirPosicionTooltip(label.kind, label.coordinate, route),
  }));

  const cornersAt = (scale: number) => {
    const zoom = Math.log2(scale / 256);
    const corners: PuntoMapa[] = [];
    for (const pin of pins) {
      const { posicion, separacion, visible } = ubicarTooltipSinCruzarRuta(
        proyectarRutaRespectoAlPin(pin.coordinate, route, 0, zoom), pin.size, pin.preferred,
      );
      if (!visible) continue;
      const halfWidth = pin.size.ancho / 2 / scale;
      const reach = (TAMANO_PIN_RUTA / 2 + separacion + pin.size.alto) / scale;
      const y = posicion === 'arriba' ? pin.y + reach : pin.y - reach;
      corners.push({ x: pin.x - halfWidth, y }, { x: pin.x + halfWidth, y });
    }
    return corners;
  };

  const fitScale = (corners: readonly PuntoMapa[]) => {
    let x0 = minX;
    let x1 = maxX;
    let y0 = minY;
    let y1 = maxY;
    for (const corner of corners) {
      x0 = Math.min(x0, corner.x);
      x1 = Math.max(x1, corner.x);
      y0 = Math.min(y0, corner.y);
      y1 = Math.max(y1, corner.y);
    }
    return Math.min(
      x1 - x0 > 0 ? innerWidth / (x1 - x0) : Infinity,
      y1 - y0 > 0 ? innerHeight / (y1 - y0) : Infinity,
    );
  };

  let scale = fitScale([]);
  let previous = scale;
  let converged = false;
  for (let i = 0; i < 12 && Number.isFinite(scale) && scale > 0; i += 1) {
    const next = fitScale(cornersAt(scale));
    previous = scale;
    scale = next;
    if (Math.abs(next - previous) / previous < 0.001) {
      converged = true;
      break;
    }
  }
  // A label that flips sides between two zooms can oscillate; keep the safer one.
  if (!converged) scale = Math.min(scale, previous);
  if (!Number.isFinite(scale) || scale <= 0) return [...route];

  const extra = cornersAt(scale).map((corner) => ({
    latitude: latitudeFromMercatorY(corner.y),
    longitude: ref + corner.x * 360,
  }));
  return [...route, ...extra];
}
