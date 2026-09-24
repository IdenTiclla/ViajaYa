import type { Coordinates } from '@/core/domain/geo';

export type TooltipPlacement = 'above' | 'below';
// A single visual scale for every map, with no variants per role or screen.
// Logical sizes: react-native-maps applies each device's native density.
export const ROUTE_WIDTH = 3;
export const ROUTE_OUTLINE_WIDTH = 5;
export const ROUTE_PIN_SIZE = 16;
export const ROUTE_PIN_BORDER = 1.5;
export const ROUTE_PIN_LETTER_SIZE = 9;
export const ROUTE_TOOLTIP_MARGIN = 96;
export const EDITABLE_TOOLTIP_MARGIN = 126;
export const TOOLTIP_SEPARATION = 8;
const MAX_TOOLTIP_SEPARATION = 48;
const ROUTE_CLEARANCE = ROUTE_OUTLINE_WIDTH / 2 + 4;

export type MapPoint = { x: number; y: number };
export type LabelSize = { width: number; height: number };

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
export function projectRouteRelativeToPin(
  point: Coordinates,
  route: readonly Coordinates[],
  mapBearing: number,
  mapZoom: number,
): MapPoint[] {
  const scale = 256 * 2 ** mapZoom;
  const originY = mercatorY(point.latitude);
  const heading = mapBearing * Math.PI / 180;
  return route.map((coordinate) => {
    const east = longitudeDelta(point.longitude, coordinate.longitude) / 360 * scale;
    const north = (mercatorY(coordinate.latitude) - originY) * scale;
    return {
      x: east * Math.cos(heading) - north * Math.sin(heading),
      y: -north * Math.cos(heading) - east * Math.sin(heading),
    };
  });
}

/** Find room for the whole label, including Editar, in front of every segment. */
export function placeTooltipClearOfRoute(
  route: readonly MapPoint[],
  size: LabelSize,
  preferred: TooltipPlacement,
): { placement: TooltipPlacement; separation: number; visible: boolean } {
  const radio = ROUTE_PIN_SIZE / 2;
  const limitX = size.width / 2 + ROUTE_CLEARANCE;
  const occupied: [number, number][] = [];
  for (let i = 1; i < route.length; i += 1) {
    const a = route[i - 1];
    const b = route[i];
    // Clip the segment against the tooltip's horizontal band: checking
    // only vertices would miss a long street crossing behind the text.
    const dx = b.x - a.x;
    let start = 0;
    let end = 1;
    if (Math.abs(dx) < 0.000001) {
      if (Math.abs(a.x) > limitX) continue;
    } else {
      const t1 = (-limitX - a.x) / dx;
      const t2 = (limitX - a.x) / dx;
      start = Math.max(0, Math.min(t1, t2));
      end = Math.min(1, Math.max(t1, t2));
      if (start > end) continue;
    }
    const y1 = a.y + (b.y - a.y) * start;
    const y2 = a.y + (b.y - a.y) * end;
    occupied.push([Math.min(y1, y2) - ROUTE_CLEARANCE, Math.max(y1, y2) + ROUTE_CLEARANCE]);
  }

  const freeSeparation = (placement: TooltipPlacement) => {
    const intervals = occupied.map(([min, max]): [number, number] =>
      placement === 'above' ? [-max, -min] : [min, max],
    ).sort((a, b) => a[0] - b[0]);
    let border = radio + TOOLTIP_SEPARATION;
    for (const [start, end] of intervals) {
      if (end < border) continue;
      if (start > border + size.height) break;
      border = end + 1;
    }
    return border - radio;
  };
  const opposite = preferred === 'above' ? 'below' : 'above';
  const primary = freeSeparation(preferred);
  const alternative = freeSeparation(opposite);
  const chosenPlacement = primary <= alternative ? preferred : opposite;
  const separation = Math.min(primary, alternative);
  // At a zoom that is too far out no label may fit. We prioritize
  // the route and keep its native title available when tapping A/B; we never create
  // a giant bitmap nor place text over the route as a fallback.
  return separation <= MAX_TOOLTIP_SEPARATION
    ? { placement: chosenPlacement, separation, visible: true }
    : { placement: preferred, separation: TOOLTIP_SEPARATION, visible: false };
}

/** Place the text on the side opposite the segment entering or leaving the point. */
export function chooseTooltipPlacement(
  kind: 'A' | 'B',
  point: Coordinates,
  route: readonly Coordinates[],
  mapBearing = 0,
): TooltipPlacement {
  const preferred = kind === 'A' ? 'above' : 'below';
  const cosLatitude = Math.cos(point.latitude * Math.PI / 180);
  const heading = mapBearing * Math.PI / 180;
  let east = 0;
  let north = 0;
  // Skip duplicates and the provider's small snap to the street. Using the
  // opposite end would fail on routes that first turn in another direction.
  for (let i = 0; i < route.length; i += 1) {
    const neighbor = route[kind === 'A' ? i : route.length - 1 - i];
    east = (neighbor.longitude - point.longitude) * cosLatitude;
    north = neighbor.latitude - point.latitude;
    if (Math.hypot(east, north) >= 0.0001) break;
  }
  const longitude = Math.hypot(east, north);
  if (longitude === 0) return preferred;
  // The camera bearing also counts: after rotating the map, geographic north
  // no longer matches the top of the screen. A horizontal segment uses each letter's
  // stable side so labels do not flip due to rounding.
  const upward = north * Math.cos(heading) + east * Math.sin(heading);
  if (Math.abs(upward) < longitude * 0.1) return preferred;
  return upward > 0 ? 'below' : 'above';
}

/** Keep the symbol's center on the coordinate, even with several lines. */
export function computePinAnchor(height: number, placement: TooltipPlacement) {
  const actualHeight = Math.max(height, ROUTE_PIN_SIZE);
  const pinCenter = placement === 'above'
    ? actualHeight - ROUTE_PIN_SIZE / 2
    : ROUTE_PIN_SIZE / 2;
  return { x: 0.5, y: pinCenter / actualHeight };
}

/** Give the native layout room before regenerating the Google Maps bitmap. */
export function scheduleMarkerRedraw(
  redraw: () => void,
  requestFrame = requestAnimationFrame,
  cancelFrame = cancelAnimationFrame,
): () => void {
  let cancelled = false;
  let frame = requestFrame(() => {
    if (cancelled) return;
    frame = requestFrame(() => {
      if (!cancelled) redraw();
    });
  });
  return () => {
    cancelled = true;
    cancelFrame(frame);
  };
}

export type RoutePinLabel = {
  kind: 'A' | 'B';
  coordinate: Coordinates;
  /** Measured label block (RoutePinMarker reports it), in logical pixels. */
  size: LabelSize;
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
    preferred: chooseTooltipPlacement(label.kind, label.coordinate, route),
  }));

  const cornersAt = (scale: number) => {
    const zoom = Math.log2(scale / 256);
    const corners: MapPoint[] = [];
    for (const pin of pins) {
      const { placement, separation, visible } = placeTooltipClearOfRoute(
        projectRouteRelativeToPin(pin.coordinate, route, 0, zoom), pin.size, pin.preferred,
      );
      if (!visible) continue;
      const halfWidth = pin.size.width / 2 / scale;
      const reach = (ROUTE_PIN_SIZE / 2 + separation + pin.size.height) / scale;
      const y = placement === 'above' ? pin.y + reach : pin.y - reach;
      corners.push({ x: pin.x - halfWidth, y }, { x: pin.x + halfWidth, y });
    }
    return corners;
  };

  const fitScale = (corners: readonly MapPoint[]) => {
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
