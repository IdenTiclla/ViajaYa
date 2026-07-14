/**
 * Tags de oferta derivados client-side (no vienen del backend).
 *
 * A partir de la lista de ofertas vigentes se marcan: la más barata (ECONÓMICO),
 * la de menor ETA (RÁPIDO) y la de mejor calificación (MEJOR VALORADO). Una tarjeta
 * puede tener varios tags; al render se prioriza precio, llegada y valoración.
 * Los extremos se aplican a todas las ofertas que compartan el valor (empates).
 */
import type { Offer } from '@/features/rides/domain/types';

export type OfferTagKind = 'cheapest' | 'fastest' | 'bestRated';

export type OfferTag = {
  kind: OfferTagKind;
  label: string;
  subLabel: string;
};

const TAG_INFO: Record<OfferTagKind, { label: string; subLabel: string }> = {
  cheapest: { label: 'ECONÓMICO', subLabel: 'Mejor precio' },
  fastest: { label: 'RÁPIDO', subLabel: 'Más rápido' },
  bestRated: { label: 'MEJOR VALORADO', subLabel: 'Mejor calificado' },
};

/** Orden de prioridad de display cuando una tarjeta tiene varios tags. */
const PRIORITY: OfferTagKind[] = ['cheapest', 'fastest', 'bestRated'];

/**
 * Para cada offerId, devuelve sus tags (puede ser ninguno, uno o varios).
 * Devuelve un mapa offerId → tags. Con listas vacías devuelve {}.
 */
export function deriveOfferTags(offers: Offer[]): Record<string, OfferTag[]> {
  const result: Record<string, OfferTag[]> = {};
  if (offers.length === 0) return result;

  const minPrice = Math.min(...offers.map((o) => o.price));
  const etas = offers.map((o) => o.etaMin).filter((e): e is number => e != null);
  const minEta = etas.length > 0 ? Math.min(...etas) : null;
  const ratings = offers.map((o) => o.driver.rating).filter((r): r is number => r != null);
  const maxRating = ratings.length > 0 ? Math.max(...ratings) : null;

  for (const o of offers) {
    const tags: OfferTag[] = [];
    if (o.price === minPrice) tags.push({ kind: 'cheapest', ...TAG_INFO.cheapest });
    if (minEta != null && o.etaMin === minEta) {
      tags.push({ kind: 'fastest', ...TAG_INFO.fastest });
    }
    if (maxRating != null && o.driver.rating === maxRating) {
      tags.push({ kind: 'bestRated', ...TAG_INFO.bestRated });
    }
    if (tags.length > 0) result[o.id] = tags;
  }
  return result;
}

/** Tag principal a mostrar (el de mayor prioridad), o null si no tiene. */
export function primaryTag(tags: OfferTag[] | undefined): OfferTag | null {
  if (!tags || tags.length === 0) return null;
  for (const kind of PRIORITY) {
    const found = tags.find((t) => t.kind === kind);
    if (found) return found;
  }
  return tags[0];
}
