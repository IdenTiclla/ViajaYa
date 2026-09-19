import type { Offer } from './types';

export type OfferOrder = 'recent' | 'price' | 'arrival';

/** Keep equal offers stable so ongoing updates do not reshuffle a decision. */
export function orderOffers(offers: readonly Offer[], order: OfferOrder): Offer[] {
  const value = (offer: Offer) => {
    if (order === 'price') return offer.price;
    if (order === 'arrival') return offer.etaMin ?? Number.POSITIVE_INFINITY;
    const created = offer.createdAt ? Date.parse(offer.createdAt) : Number.NaN;
    return Number.isFinite(created) ? -created : Number.POSITIVE_INFINITY;
  };
  return [...offers].sort((left, right) => value(left) - value(right));
}
