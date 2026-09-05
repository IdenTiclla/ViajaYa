/** Verifica activo y calificación con un límite para toda la recuperación. */
type ResultadoConsulta = {
  isSuccess: boolean;
  data?: unknown;
  error: unknown;
};

type Consultar = () => Promise<ResultadoConsulta>;

export async function confirmarRecuperacion(
  consultarActivo: Consultar,
  consultarCalificacion: Consultar,
  limiteMs = 30_000,
): Promise<void> {
  let agotado = false;
  let temporizador: ReturnType<typeof setTimeout> | undefined;
  const limite = new Promise<never>((_, reject) => {
    temporizador = setTimeout(() => {
      agotado = true;
      reject(new Error('La verificación tardó demasiado. Revisa tu conexión y vuelve a intentar.'));
    }, limiteMs);
  });
  const verificar = async () => {
    const activo = await consultarActivo();
    if (agotado) return;
    if (!activo.isSuccess) throw activo.error;
    if (activo.data == null) {
      const calificacion = await consultarCalificacion();
      if (!calificacion.isSuccess) throw calificacion.error;
    }
  };
  try {
    // También acota consultas pausadas por conectividad o reintentos internos.
    await Promise.race([verificar(), limite]);
  } finally {
    clearTimeout(temporizador);
  }
}
