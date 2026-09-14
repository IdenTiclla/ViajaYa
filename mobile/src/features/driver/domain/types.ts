import type { DriverStatus, VehicleType } from '@/features/auth/domain/types';
import type { ServiceType } from '@/features/booking/domain/types';

/** One vehicle the account registered to drive with (at most one per type). */
export type DriverVehicle = {
  id: string;
  vehicleType: VehicleType;
  plate: string;
  vehicleModel: string;
  services: ServiceType[];
  status: DriverStatus;
  createdAt: string | null;
};

export type DriverVehicleInput = {
  vehicleType: VehicleType;
  plate: string;
  vehicleModel: string;
  services: ServiceType[];
};

/** Maximum number of vehicles: one per `VehicleType`. */
export const MAX_DRIVER_VEHICLES = 3;
