/** Extrae un mensaje legible de un error de axios / API. */
import axios from 'axios';

export function getApiErrorMessage(error: unknown, fallback = 'Algo salió mal. Inténtalo de nuevo.'): string {
  // eslint-disable-next-line import/no-named-as-default-member
  if (axios.isAxiosError(error)) {
    const detail = error.response?.data?.detail;
    if (typeof detail === 'string') return detail;
    // FastAPI puede devolver detail como lista de errores de validación.
    if (Array.isArray(detail) && detail[0]?.msg) return String(detail[0].msg);
    if (!error.response) return 'No se pudo conectar con el servidor.';
  }
  return fallback;
}
