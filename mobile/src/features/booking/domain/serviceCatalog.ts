import type { ServiceType } from '@/features/booking/domain/types';

type ServiceMeta = {
  label: string;
  shortLabel: string;
  icon: 'car-sport' | 'bicycle' | 'cube' | 'home';
};

/** Presentacion exhaustiva de cada servicio ofrecido por ViajaYa. */
export const SERVICE_META = {
  taxi: { label: 'Taxi', shortLabel: 'Taxi', icon: 'car-sport' },
  moto: { label: 'Mototaxi', shortLabel: 'Mototaxi', icon: 'bicycle' },
  delivery: {
    label: 'Cargas y encomiendas',
    shortLabel: 'Encomiendas',
    icon: 'cube',
  },
  moving: { label: 'Mudanzas', shortLabel: 'Mudanza', icon: 'home' },
} as const satisfies Record<ServiceType, ServiceMeta>;

const SERVICE_ORDER: readonly ServiceType[] = ['taxi', 'moto', 'delivery', 'moving'];

export const SERVICE_OPTIONS = SERVICE_ORDER.map((id) => ({ id, ...SERVICE_META[id] }));
