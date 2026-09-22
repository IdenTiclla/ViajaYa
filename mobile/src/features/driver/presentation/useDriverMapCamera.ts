import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import type MapView from 'react-native-maps';

import type { Coordinates } from '@/core/domain/geo';

type ScreenPoint = { x: number; y: number };

/** Keep the camera locked and project the radar onto the native GPS marker. */
export function useDriverMapCamera(
  mapRef: RefObject<MapView | null>,
  coordinates: Coordinates,
  ready: boolean,
  width: number,
  height: number,
) {
  const [radarPoint, setRadarPoint] = useState<ScreenPoint | null>(null);
  const projection = useRef({ version: 0 });
  const { latitude, longitude } = coordinates;
  const updateRadarPosition = useCallback(() => {
    const map = mapRef.current;
    if (!ready || !map || width <= 0 || height <= 0) return;
    const state = projection.current;
    const version = ++state.version;
    void map.pointForCoordinate({ latitude, longitude }).then(point => {
      if (version !== state.version) return;
      const visible = Number.isFinite(point.x) && Number.isFinite(point.y)
        && point.x >= 0 && point.x <= width && point.y >= 0 && point.y <= height;
      setRadarPoint(visible ? point : null);
    }).catch(() => {
      if (version === state.version) setRadarPoint(null);
    });
  }, [mapRef, latitude, longitude, ready, width, height, projection]);

  useEffect(() => {
    if (!ready || width <= 0 || height <= 0) return;
    const state = projection.current;
    const frame = requestAnimationFrame(() => {
      // A non-animated camera keeps the vehicle and radar together during GPS
      // updates and avoids native tab-mount animation offsets.
      mapRef.current?.setCamera({ center: { latitude, longitude }, zoom: 16, heading: 0, pitch: 0 });
      updateRadarPosition();
    });
    return () => {
      cancelAnimationFrame(frame);
      state.version++;
    };
  }, [mapRef, latitude, longitude, ready, width, height, updateRadarPosition, projection]);

  return { radarPoint, updateRadarPosition };
}
