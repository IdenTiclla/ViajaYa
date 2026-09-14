import type { VehicleType } from '@/features/auth/domain/types';
import type { ServiceType } from '@/features/booking/domain/types';

type VehicleMeta = {
  label: string;
  icon: 'car-sport' | 'bicycle' | 'bus';
};

/** Presentation of each physical vehicle a driver can register. */
export const VEHICLE_META = {
  taxi: { label: 'Taxi', icon: 'car-sport' },
  moto: { label: 'Moto', icon: 'bicycle' },
  truck: { label: 'Camioneta', icon: 'bus' },
} as const satisfies Record<VehicleType, VehicleMeta>;

export const VEHICLE_ORDER: readonly VehicleType[] = ['taxi', 'moto', 'truck'];

/**
 * Services each vehicle may offer (mirrors `services_for_vehicle` in the backend).
 * A driver chooses a non-empty subset when applying.
 */
export const SERVICES_FOR_VEHICLE = {
  taxi: ['taxi', 'delivery'],
  moto: ['moto', 'delivery'],
  truck: ['moving'],
} as const satisfies Record<VehicleType, readonly ServiceType[]>;

export function vehicleLabel(vehicleType: VehicleType | null | undefined): string | null {
  return vehicleType ? VEHICLE_META[vehicleType].label : null;
}
