/**
 * Turn the map center into a `Place` every time the user finishes
 * moving the camera. It first delivers the coordinates with a usable label
 * and then enriches it through reverse geocoding. A `useRef` guard
 * deduplicates identical centers and discards stale results if the user moves
 * the map again before a previous geocoding resolves.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Region } from 'react-native-maps';

import type { Coordinates, Place } from '@/features/booking/domain/types';
import { locationService } from '@/features/home/data/locationService';

function sameCoordinates(a: Coordinates, b: Coordinates): boolean {
  // MapView may return the same center with a tiny decimal variation
  // after animateToRegion. Treating it as a new point restarts (or even
  // cancels) the first address even though the passenger did not move the map.
  return (
    Math.abs(a.latitude - b.latitude) < 0.00001 &&
    Math.abs(a.longitude - b.longitude) < 0.00001
  );
}

function coordinateAddress({ latitude, longitude }: Coordinates): string {
  return `${latitude.toFixed(5)}, ${longitude.toFixed(5)}`;
}

export function useRegionPlace(onPlace: (place: Place) => void) {
  const latest = useRef<Coordinates | null>(null);
  const latestRequestId = useRef(0);
  const pending = useRef<Coordinates | null>(null);
  const [isResolving, setIsResolving] = useState(false);
  const [resolutionFailed, setResolutionFailed] = useState(false);

  const cancelPendingResolution = useCallback(() => {
    latestRequestId.current += 1;
    latest.current = null;
    pending.current = null;
    setIsResolving(false);
    setResolutionFailed(false);
  }, []);

  useEffect(
    () => () => {
      // Invalidate late responses so a logout or screen change does not
      // write to the global store again after this hook unmounts.
      latestRequestId.current += 1;
      latest.current = null;
      pending.current = null;
    },
    [],
  );

  const onRegionChangeComplete = useCallback(
    (region: Region) => {
      const coordinates = { latitude: region.latitude, longitude: region.longitude };
      if (pending.current && sameCoordinates(pending.current, coordinates)) return;

      const requestId = latestRequestId.current + 1;
      latestRequestId.current = requestId;
      latest.current = coordinates;
      pending.current = coordinates;
      setIsResolving(true);
      setResolutionFailed(false);
      onPlace({
        coordinates,
        name: '',
        address: coordinateAddress(coordinates),
        countryCode: null,
        labelStatus: 'provisional',
      });

      void locationService
        .reverseGeocode(coordinates)
        .then((label) => {
          const current = latest.current;
          if (
            label &&
            latestRequestId.current === requestId &&
            current &&
            sameCoordinates(current, coordinates)
          ) {
            onPlace({ coordinates, ...label });
          } else if (latestRequestId.current === requestId && !label) {
            setResolutionFailed(true);
          }
        })
        .finally(() => {
          if (latestRequestId.current === requestId) {
            pending.current = null;
            setIsResolving(false);
          }
        });
    },
    [onPlace],
  );

  return {
    onRegionChangeComplete,
    isResolving,
    resolutionFailed,
    cancelPendingResolution,
  };
}
