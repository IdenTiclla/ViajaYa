/** El GPS expresa el rumbo en grados desde el norte, en sentido horario. */
export function esRumboValido(rumbo: number | null): rumbo is number {
  return rumbo != null && Number.isFinite(rumbo) && rumbo >= 0 && rumbo < 360;
}

/** Cruza el norte por el giro más corto, sin completar una vuelta adicional. */
export function calcularRotacionVehiculo(actual: number, rumbo: number | null): number {
  if (!esRumboValido(rumbo)) return actual;
  const diferencia = (((rumbo - actual) % 360) + 540) % 360 - 180;
  return actual + diferencia;
}
