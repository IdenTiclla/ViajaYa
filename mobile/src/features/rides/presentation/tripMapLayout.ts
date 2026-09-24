/** Preserve a usable camera viewport when the trip sheet grows or rotates. */
export function getTripMapPadding(
  width: number,
  height: number,
  topOverlay: number,
  bottomOverlay: number,
  tooltipInset = 40,
  sideInset = 44,
) {
  const minimumRouteHeight = Math.min(64, height / 2);
  const top = Math.min(Math.max(0, topOverlay), height / 4);
  const bottom = Math.min(Math.max(0, bottomOverlay), height - top - minimumRouteHeight);
  const tooltip = Math.min(Math.max(0, tooltipInset), Math.max(0, (height - top - bottom - minimumRouteHeight) / 2));
  const side = Math.min(Math.max(0, sideInset), width / 4);
  return { top: Math.floor(top + tooltip), bottom: Math.floor(bottom + tooltip), left: Math.floor(side), right: Math.floor(side) };
}

type LatLng = { latitude: number; longitude: number };

/** Screen footprint of a pin label, in logical pixels, relative to its pin. */
export type TooltipFootprint = {
  coordinate: LatLng;
  placement: 'above' | 'below';
  width: number;
  height: number;
  /** Gap between the pin center and the nearest edge of the label. */
  offset: number;
};

const toMercatorX = (longitude: number) => longitude / 360;
const toMercatorY = (latitude: number) => {
  const radians = Math.max(-85, Math.min(85, latitude)) * Math.PI / 180;
  return Math.log(Math.tan(Math.PI / 4 + radians / 2)) / (2 * Math.PI);
};
const fromMercatorY = (y: number) => (2 * Math.atan(Math.exp(y * 2 * Math.PI)) - Math.PI / 2) * 180 / Math.PI;

/**
 * Extra points so `fitToCoordinates` frames the route *and* its pin labels.
 * The label size is fixed in pixels while the map scale depends on the fit, so
 * the scale is refined a few times until the labels' corners fit the viewport.
 */
export function getTooltipFitCoordinates(
  route: readonly LatLng[],
  tooltips: readonly TooltipFootprint[],
  width: number,
  height: number,
  padding: { top: number; bottom: number; left: number; right: number },
): LatLng[] {
  const innerWidth = width - padding.left - padding.right;
  const innerHeight = height - padding.top - padding.bottom;
  if (route.length < 2 || tooltips.length === 0 || innerWidth <= 0 || innerHeight <= 0) return [...route];

  const xs = route.map((point) => toMercatorX(point.longitude));
  const ys = route.map((point) => toMercatorY(point.latitude));
  const routeWidth = Math.max(...xs) - Math.min(...xs);
  const routeHeight = Math.max(...ys) - Math.min(...ys);
  if (routeWidth <= 0 && routeHeight <= 0) return [...route];

  const cornersAt = (scale: number) => tooltips.flatMap((tooltip) => {
    const x = toMercatorX(tooltip.coordinate.longitude);
    const y = toMercatorY(tooltip.coordinate.latitude);
    const halfWidth = tooltip.width / 2 / scale;
    const reach = (tooltip.offset + tooltip.height) / scale;
    const farY = tooltip.placement === 'above' ? y + reach : y - reach;
    return [{ x: x - halfWidth, y: farY }, { x: x + halfWidth, y: farY }];
  });

  let scale = Math.min(
    routeWidth > 0 ? innerWidth / routeWidth : Infinity,
    routeHeight > 0 ? innerHeight / routeHeight : Infinity,
  );
  for (let i = 0; i < 12; i += 1) {
    const corners = cornersAt(scale);
    const allX = [...xs, ...corners.map((corner) => corner.x)];
    const allY = [...ys, ...corners.map((corner) => corner.y)];
    const next = Math.min(
      innerWidth / (Math.max(...allX) - Math.min(...allX)),
      innerHeight / (Math.max(...allY) - Math.min(...allY)),
    );
    if (!Number.isFinite(next) || next <= 0) break;
    const converged = Math.abs(next - scale) / scale < 0.001;
    scale = next;
    if (converged) break;
  }

  const extra = cornersAt(scale).map((corner) => ({
    latitude: fromMercatorY(corner.y),
    longitude: corner.x * 360,
  }));
  return [...route, ...extra];
}
