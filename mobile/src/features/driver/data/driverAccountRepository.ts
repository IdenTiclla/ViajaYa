/** Driver application and account mode (`/drivers/me/application`, `/drivers/me/mode`). */
import { api } from '@/core/http/client';
import { toUser, type AuthResponseDto } from '@/features/auth/data/mappers';
import type { User, UserRole, VehicleType } from '@/features/auth/domain/types';
import type { ServiceType } from '@/features/booking/domain/types';

export type DriverApplicationInput = {
  vehicleType: VehicleType;
  plate: string;
  vehicleModel: string;
  services: ServiceType[];
};

type UserDto = AuthResponseDto['user'];

export const driverAccountRepository = {
  /** Registers (or updates) the vehicle and services; the account stays a passenger. */
  async apply(input: DriverApplicationInput): Promise<User> {
    const { data } = await api.post<UserDto>('/drivers/me/application', {
      vehicle_type: input.vehicleType,
      plate: input.plate,
      vehicle_model: input.vehicleModel,
      services: input.services,
    });
    return toUser(data);
  },

  /** Switches the active mode; only approved drivers may enter `driver`. */
  async switchMode(mode: UserRole): Promise<User> {
    const { data } = await api.post<UserDto>('/drivers/me/mode', { mode });
    return toUser(data);
  },
};
