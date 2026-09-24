/** Bound a wait; a late resolution no longer changes its result. */
export function conTiempoLimite<T>(
  operacion: Promise<T>,
  limiteMs: number,
  mensaje: string,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const temporizador = setTimeout(() => reject(new Error(mensaje)), limiteMs);
    operacion.then(
      (resultado) => { clearTimeout(temporizador); resolve(resultado); },
      (error: unknown) => { clearTimeout(temporizador); reject(error); },
    );
  });
}
