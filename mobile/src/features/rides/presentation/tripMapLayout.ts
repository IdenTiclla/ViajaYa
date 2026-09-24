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
