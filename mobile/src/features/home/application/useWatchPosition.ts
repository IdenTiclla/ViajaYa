/**
 * Continuous location hook (driver navigation): subscribes to
 * GPS and compass. Expo handles the native pause in the background; keeping the
 * subscription avoids competing with that resume and restarting the GPS acquisition.
 */
import { useEffect, useState } from 'react';
import { AppState } from 'react-native';

import type { Coordinates } from '@/core/domain/geo';
import { locationService } from '@/features/home/data/locationService';

export type WatchStatus = 'loading' | 'granted' | 'denied' | 'disabled' | 'error';

export type WatchedPosition = {
  status: WatchStatus;
  coordinates: Coordinates | null;
  /** Movement heading or compass, in degrees from north. */
  heading: number | null;
  retry: () => void;
};

export function useWatchPosition(habilitado = true): WatchedPosition {
  const [attempt, setAttempt] = useState(0);
  const [position, setPosition] = useState<Omit<WatchedPosition, 'retry'>>({
    status: 'loading', coordinates: null, heading: null,
  });

  useEffect(() => {
    if (!habilitado) return;
    let active = true;
    let subscription: { remove: () => void } | null = null;
    let cancelacion: AbortController | null = null;
    let generacion = 0;
    let estadoApp = AppState.currentState;
    let iniciando = false;
    let tienePosicion = false;
    let salidaEn = 0;
    let espera: ReturnType<typeof setTimeout> | undefined;

    const cancelarEspera = () => { clearTimeout(espera); };
    const esperarPosicion = () => {
      cancelarEspera();
      if (tienePosicion || estadoApp === 'background') return;
      espera = setTimeout(() => {
        if (!active || tienePosicion) return;
        // The listener stays alive: a late signal recovers the map.
        setPosition({ status: 'error', coordinates: null, heading: null });
      }, 15_000);
    };
    const detener = () => {
      generacion += 1;
      cancelarEspera();
      cancelacion?.abort();
      cancelacion = null;
      subscription?.remove();
      subscription = null;
      iniciando = false;
    };
    const iniciar = () => {
      if (!active || subscription || iniciando) return;
      detener();
      iniciando = true;
      tienePosicion = false;
      const controlador = new AbortController();
      cancelacion = controlador;
      const intento = generacion;
      setPosition({ status: 'loading', coordinates: null, heading: null });
      const vigente = () => active && intento === generacion;
      const fallar = (motivo: 'error' | 'disabled' = 'error') => {
        if (!vigente()) return;
        detener();
        setPosition({ status: motivo, coordinates: null, heading: null });
      };

      void locationService
        .watchPosition((coords, hd) => {
          if (!vigente() || estadoApp === 'background') return;
          tienePosicion = true;
          cancelarEspera();
          setPosition({ status: 'granted', coordinates: coords, heading: hd });
        }, fallar, controlador.signal)
        .then((sub) => {
          if (!vigente()) {
            sub?.remove();
            return;
          }
          iniciando = false;
          if (sub == null) {
            cancelarEspera();
            setPosition({ status: 'denied', coordinates: null, heading: null });
          } else {
            subscription = sub;
            esperarPosicion();
          }
        })
        .catch(() => fallar());
    };
    const escucha = AppState.addEventListener('change', (siguiente) => {
      const anterior = estadoApp;
      if (siguiente !== 'inactive') estadoApp = siguiente;
      if (siguiente === 'background') {
        salidaEn = Date.now();
        cancelarEspera();
      }
      if (siguiente !== 'active' || anterior !== 'background' || iniciando) return;
      if (!subscription) { iniciar(); return; }
      if (Date.now() - salidaEn > 30_000) {
        tienePosicion = false;
        setPosition({ status: 'loading', coordinates: null, heading: null });
      }
      // Keep the healthy watcher. Only remove it if the permissions changed or
      // location was turned off while the app was in the background.
      const intento = generacion;
      void locationService.consultarDisponibilidad().then((disponibilidad) => {
        if (!active || intento !== generacion || estadoApp !== 'active') return;
        if (disponibilidad !== 'granted') {
          detener();
          setPosition({ status: disponibilidad, coordinates: null, heading: null });
          return;
        }
        esperarPosicion();
      }).catch(() => { /* Una consulta fallida no interrumpe un GPS activo. */ });
    });
    if (estadoApp !== 'background') iniciar();

    return () => {
      active = false;
      detener();
      escucha.remove();
    };
  }, [attempt, habilitado]);

  return {
    ...position,
    retry: () => {
      setAttempt((n) => n + 1);
    },
  };
}
