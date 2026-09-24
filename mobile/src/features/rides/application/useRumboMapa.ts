import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';

type MapWithCamera = { getCamera: () => Promise<{ heading: number; zoom?: number }> };

/** Update the scale and orientation used to separate labels from the route. */
export function useMapBearing(map: RefObject<MapWithCamera | null>) {
  const [camera, setCamera] = useState<{ mapBearing: number; mapZoom?: number }>({ mapBearing: 0 });
  const generation = useRef(0);
  useEffect(() => () => { generation.current += 1; }, []);

  const updateBearing = useCallback(() => {
    const instance = map.current;
    if (!instance) return;
    const request = ++generation.current;
    void instance.getCamera().then(({ heading, zoom }) => {
      if (request === generation.current && map.current === instance && Number.isFinite(heading)) {
        setCamera((current) => {
          const mapZoom = Number.isFinite(zoom) ? zoom : current.mapZoom;
          return current.mapBearing === heading && current.mapZoom === mapZoom
            ? current : { mapBearing: heading, mapZoom };
        });
      }
    }).catch(() => {
      // Un mapa desmontándose conserva el último rumbo válido.
    });
  }, [map]);

  return { ...camera, updateBearing };
}
