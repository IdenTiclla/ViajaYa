import type { ServiceType } from '@/features/booking/domain/types';

export type ServiceNouns = {
  /** Who requested it, lowercase ("pasajero", "remitente", "cliente"). */
  customer: string;
  /** Same noun capitalised for labels. */
  customerTitle: string;
  /** What is being done ("viaje", "entrega", "mudanza"). */
  request: string;
};

const NOUNS: Record<ServiceType, ServiceNouns> = {
  taxi: { customer: 'pasajero', customerTitle: 'Pasajero', request: 'viaje' },
  moto: { customer: 'pasajero', customerTitle: 'Pasajero', request: 'viaje' },
  delivery: { customer: 'remitente', customerTitle: 'Remitente', request: 'entrega' },
  moving: { customer: 'cliente', customerTitle: 'Cliente', request: 'mudanza' },
};

/** Driver-side wording for a request of the given service. */
export function serviceNouns(service: ServiceType): ServiceNouns {
  return NOUNS[service];
}
