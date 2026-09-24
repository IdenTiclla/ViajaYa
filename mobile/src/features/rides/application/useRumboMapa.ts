import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';

type MapaConCamara = { getCamera: () => Promise<{ heading: number; zoom?: number }> };

/** Update the scale and orientation used to separate labels from the route. */
export function useRumboMapa(mapa: RefObject<MapaConCamara | null>) {
  const [camara, setCamara] = useState<{ rumboMapa: number; zoomMapa?: number }>({ rumboMapa: 0 });
  const generacion = useRef(0);
  useEffect(() => () => { generacion.current += 1; }, []);

  const actualizarRumbo = useCallback(() => {
    const instancia = mapa.current;
    if (!instancia) return;
    const solicitud = ++generacion.current;
    void instancia.getCamera().then(({ heading, zoom }) => {
      if (solicitud === generacion.current && mapa.current === instancia && Number.isFinite(heading)) {
        setCamara((actual) => {
          const zoomMapa = Number.isFinite(zoom) ? zoom : actual.zoomMapa;
          return actual.rumboMapa === heading && actual.zoomMapa === zoomMapa
            ? actual : { rumboMapa: heading, zoomMapa };
        });
      }
    }).catch(() => {
      // Un mapa desmontándose conserva el último rumbo válido.
    });
  }, [mapa]);

  return { ...camara, actualizarRumbo };
}
