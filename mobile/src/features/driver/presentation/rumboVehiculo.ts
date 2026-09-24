/** GPS expresses the heading in degrees from north, clockwise. */
export function esRumboValido(rumbo: number | null): rumbo is number {
  return rumbo != null && Number.isFinite(rumbo) && rumbo >= 0 && rumbo < 360;
}

/** Cross north through the shortest turn, without an extra full rotation. */
export function calcularRotacionVehiculo(actual: number, rumbo: number | null): number {
  if (!esRumboValido(rumbo)) return actual;
  const diferencia = (((rumbo - actual) % 360) + 540) % 360 - 180;
  return actual + diferencia;
}
