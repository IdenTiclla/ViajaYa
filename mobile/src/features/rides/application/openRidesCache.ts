import type { InfiniteData } from '@tanstack/react-query';

import type { CursorPage } from '@/features/rides/data/ridesRepository';
import type { OpenRide } from '@/features/rides/domain/types';

export type OpenRidesInfiniteData = InfiniteData<CursorPage<OpenRide>>;

export function openRidesSnapshot(
  page: CursorPage<OpenRide>,
): OpenRidesInfiniteData {
  return {
    pages: [page],
    pageParams: [null],
  };
}

export function emptyOpenRides(): OpenRidesInfiniteData {
  return openRidesSnapshot({ items: [], nextCursor: null });
}

export function flattenOpenRides(
  data: OpenRidesInfiniteData | undefined,
): OpenRide[] {
  const seen = new Set<string>();
  const rides: OpenRide[] = [];

  for (const page of data?.pages ?? []) {
    for (const ride of page.items) {
      if (seen.has(ride.id)) continue;
      seen.add(ride.id);
      rides.push(ride);
    }
  }

  return rides;
}

/** Inserta una solicitud nueva al inicio o reemplaza la posición ya conocida. */
export function upsertOpenRide(
  data: OpenRidesInfiniteData | undefined,
  ride: OpenRide,
): OpenRidesInfiniteData {
  if (!data?.pages.length) {
    return openRidesSnapshot({ items: [ride], nextCursor: null });
  }

  let replaced = false;
  const pages = data.pages.map((page) => ({
    ...page,
    items: page.items.flatMap((item) => {
      if (item.id !== ride.id) return [item];
      if (replaced) return [];
      replaced = true;
      return [ride];
    }),
  }));

  if (!replaced) {
    pages[0] = {
      ...pages[0],
      items: [ride, ...pages[0].items],
    };
  }

  return { ...data, pages };
}

export function removeOpenRide(
  data: OpenRidesInfiniteData | undefined,
  rideId: string,
): OpenRidesInfiniteData | undefined {
  if (!data) return data;
  return {
    ...data,
    pages: data.pages.map((page) => ({
      ...page,
      items: page.items.filter((ride) => ride.id !== rideId),
    })),
  };
}

/**
 * Antepone el snapshot de solicitudes pausadas sin descartar páginas abiertas
 * ya cargadas ni sus cursores. Los duplicados se retiran de las demás páginas.
 */
export function prependPausedOpenRides(
  data: OpenRidesInfiniteData | undefined,
  pausedRides: OpenRide[],
): OpenRidesInfiniteData {
  if (pausedRides.length === 0) return data ?? emptyOpenRides();

  const pausedIds = new Set(pausedRides.map((ride) => ride.id));
  if (!data?.pages.length) {
    return openRidesSnapshot({ items: pausedRides, nextCursor: null });
  }

  const pages = data.pages.map((page) => ({
    ...page,
    items: page.items.filter((ride) => !pausedIds.has(ride.id)),
  }));
  pages[0] = {
    ...pages[0],
    items: [...pausedRides, ...pages[0].items],
  };

  return { ...data, pages };
}
