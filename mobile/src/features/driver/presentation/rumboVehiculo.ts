/** GPS expresses the heading in degrees from north, clockwise. */
export function isValidHeading(heading: number | null): heading is number {
  return heading != null && Number.isFinite(heading) && heading >= 0 && heading < 360;
}

/** Cross north through the shortest turn, without an extra full rotation. */
export function computeVehicleRotation(current: number, heading: number | null): number {
  if (!isValidHeading(heading)) return current;
  const difference = (((heading - current) % 360) + 540) % 360 - 180;
  return current + difference;
}
