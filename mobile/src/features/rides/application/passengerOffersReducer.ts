import type { Offer } from '@/features/rides/domain/types';

export type PassengerOfferEvent =
  | { type: 'snapshot'; offers: Offer[] }
  | { type: 'created'; offer: Offer }
  | {
      type: 'withdrawn';
      driverId: string;
      offerId?: string | null;
      reason?: 'superseded' | 'driver_offline';
    }
  | { type: 'expired'; offerId: string };

export type PassengerOfferNotice = {
  kind: 'received' | 'withdrawn' | 'expired';
  offer: Offer;
};

export type PassengerOffersReduction = {
  offers: Offer[];
  notice: PassengerOfferNotice | null;
};

/**
 * Reduce the passenger's offer state without touching cache, stores or UI.
 * The notification describes the effect the hook must emit afterwards.
 */
export function reducePassengerOffers(
  current: Offer[],
  event: PassengerOfferEvent,
): PassengerOffersReduction {
  switch (event.type) {
    case 'snapshot':
      return { offers: [...event.offers], notice: null };
    case 'created': {
      const existing = current.find((offer) => offer.id === event.offer.id);
      if (existing) {
        return {
          offers: current.map((offer) =>
            offer.id === event.offer.id ? event.offer : offer,
          ),
          notice: null,
        };
      }
      return {
        offers: [
          event.offer,
          ...current.filter(
            (offer) => offer.driver.id !== event.offer.driver.id,
          ),
        ],
        notice: { kind: 'received', offer: event.offer },
      };
    }
    case 'withdrawn': {
      // An improvement arrives as withdrawal + creation. Keeping the previous one during
      // that interval avoids flickering back to "Buscando".
      if (event.reason === 'superseded') {
        return { offers: current, notice: null };
      }
      const matches = (offer: Offer) =>
        event.offerId
          ? offer.id === event.offerId
          : offer.driver.id === event.driverId;
      const removed = current.find(matches);
      return {
        offers: current.filter((offer) => !matches(offer)),
        notice: removed ? { kind: 'withdrawn', offer: removed } : null,
      };
    }
    case 'expired': {
      const expired = current.find((offer) => offer.id === event.offerId);
      return {
        offers: current.filter((offer) => offer.id !== event.offerId),
        notice: expired ? { kind: 'expired', offer: expired } : null,
      };
    }
  }
}
