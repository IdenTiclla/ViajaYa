/**
 * Hook de ubicación continua (navegación del conductor): subscribe a
 * `watchPositionAsync` y expone la posición y el rumbo (`heading`) en vivo, para
 * que el mapa siga al conductor centrado y el ícono rote según la trayectoria.
 *
 * El `heading` retiene el último valor válido (cuando el vehículo se detiene el
 * rumbo no llega → mantenemos el anterior para que el ícono no salte a 0).
 */
import { useEffect, useState } from 'react';

import { type Coordinates, locationService } from '@/features/home/data/locationService';

export type WatchStatus = 'loading' | 'granted' | 'denied' | 'error';

export type WatchedPosition = {
  status: WatchStatus;
  coordinates: Coordinates | null;
  /** Rumbo en grados (0 = norte). Último valor conocido si el GPS no reporta. */
  heading: number | null;
  retry: () => void;
};

export function useWatchPosition(): WatchedPosition {
  const [attempt, setAttempt] = useState(0);
  const [status, setStatus] = useState<WatchStatus>('loading');
  const [coordinates, setCoordinates] = useState<Coordinates | null>(null);
  const [heading, setHeading] = useState<number | null>(null);

  useEffect(() => {
    let active = true;
    let subscription: { remove: () => void } | null = null;

    locationService
      .watchPosition((coords, hd) => {
        if (!active) return;
        setStatus('granted');
        setCoordinates(coords);
        if (hd != null) setHeading(hd); // conserva el último si llega null
      })
      .then((sub) => {
        if (!active) {
          sub?.remove();
          return;
        }
        if (sub == null) {
          setStatus('denied');
        } else {
          subscription = sub;
        }
      })
      .catch(() => {
        if (active) setStatus('error');
      });

    return () => {
      active = false;
      subscription?.remove();
    };
  }, [attempt]);

  return {
    status,
    coordinates,
    heading,
    retry: () => {
      setStatus('loading');
      setAttempt((n) => n + 1);
    },
  };
}
