/**
 * Complete the origin/destination labels before publishing a ride.
 *
 * The map selection may move on as soon as it has coordinates so slow devices are
 * not blocked. This barrier retries geocoding on the
 * configure screen and keeps a provisional text from reaching the driver.
 */
import { useQuery } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo } from 'react';

import { useBookingStore } from '@/features/booking/application/useBookingStore';
import { isPlaceLabelResolved } from '@/features/booking/domain/placeLabels';
import type { Place } from '@/features/booking/domain/types';
import { locationService } from '@/features/home/data/locationService';

type PointKey = 'origin' | 'destination';

function sameCoordinates(a: Place['coordinates'], b: Place['coordinates']): boolean {
  return a.latitude === b.latitude && a.longitude === b.longitude;
}

function isUsefulLabel(
  label: Awaited<ReturnType<typeof locationService.reverseGeocode>>,
): label is NonNullable<typeof label> {
  return Boolean(label && isPlaceLabelResolved(label));
}

export function useTripPlaceLabels(): {
  labelsReady: boolean;
  isResolving: boolean;
  error: string | null;
  retry: () => void;
} {
  const origin = useBookingStore((state) => state.origin);
  const destination = useBookingStore((state) => state.destination);

  const pending = useMemo(
    () =>
      ([
        origin && !isPlaceLabelResolved(origin) ? { key: 'origin' as const, place: origin } : null,
        destination && !isPlaceLabelResolved(destination)
          ? { key: 'destination' as const, place: destination }
          : null,
      ].filter(Boolean) as { key: PointKey; place: Place }[]),
    [destination, origin],
  );

  const labelsReady = Boolean(
    origin &&
      destination &&
      isPlaceLabelResolved(origin) &&
      isPlaceLabelResolved(destination),
  );

  const query = useQuery({
    queryKey: [
      'trip-place-labels',
      pending.map(({ key, place }) => [
        key,
        place.coordinates.latitude,
        place.coordinates.longitude,
      ]),
    ],
    enabled: pending.length > 0,
    retry: false,
    queryFn: async () => {
      const results: {
        key: PointKey;
        coordinates: Place['coordinates'];
        label: Awaited<ReturnType<typeof locationService.reverseGeocode>>;
      }[] = [];
      // Sequential on purpose: Android discourages several simultaneous native
      // geocodings, and the origin must not push the destination out of the queue.
      for (const item of pending) {
        results.push({
          key: item.key,
          coordinates: item.place.coordinates,
          label: await locationService.reverseGeocode(item.place.coordinates),
        });
      }
      return results;
    },
  });

  useEffect(() => {
    if (!query.data) return;
    const current = useBookingStore.getState();
    const updates: Partial<Pick<typeof current, PointKey>> = {};

    for (const item of query.data) {
      const currentPlace = current[item.key];
      if (
        isUsefulLabel(item.label) &&
        currentPlace &&
        !isPlaceLabelResolved(currentPlace) &&
        sameCoordinates(currentPlace.coordinates, item.coordinates)
      ) {
        updates[item.key] = {
          coordinates: currentPlace.coordinates,
          name: item.label.name,
          address: item.label.address,
          countryCode: item.label.countryCode ?? currentPlace.countryCode,
        };
      }
    }

    if (Object.keys(updates).length > 0) useBookingStore.setState(updates);
  }, [query.data]);

  const isResolving = pending.length > 0 && query.isFetching;
  const hasFailed =
    pending.length > 0 &&
    (query.isError || (query.isSuccess && query.data.some((item) => !isUsefulLabel(item.label))));
  const error = hasFailed
    ? 'No pudimos obtener el nombre del origen o destino. Revisa tu conexión y reintenta.'
    : null;

  const { refetch } = query;
  const retry = useCallback(() => void refetch(), [refetch]);
  return { labelsReady, isResolving, error, retry };
}
