/**
 * Segundos restantes hasta un instante objetivo (ISO), actualizado cada segundo.
 *
 * Devuelve `null` si no hay objetivo; nunca baja de 0. Útil para contadores de
 * vida (p. ej. la ventana de negociación de una solicitud de viaje). El valor se
 * calcula en render a partir de un reloj que tickea, para no llamar a setState
 * de forma síncrona dentro del efecto.
 */
import { useEffect, useState } from 'react';

export function useCountdown(target: string | null): number | null {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!target) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [target]);

  if (!target) return null;
  return Math.max(0, Math.ceil((new Date(target).getTime() - now) / 1000));
}
