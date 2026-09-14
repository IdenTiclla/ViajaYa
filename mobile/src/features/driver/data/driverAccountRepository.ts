/** Driver vehicles and account mode (`/drivers/me/vehicles`, `/drivers/me/mode`). */
import { api } from '@/core/http/client';
import { toUser, type AuthResponseDto } from '@/features/auth/data/mappers';
import type { User, UserRole, VehicleType } from '@/features/auth/domain/types';
import type { DriverVehicle, DriverVehicleInput } from '@/features/driver/domain/types';

type UserDto = AuthResponseDto['user'];

type DriverVehicleDto = {
  id: string;
  vehicle_type: DriverVehicle['vehicleType'];
  plate: string;
  vehicle_model: string;
  services: DriverVehicle['services'];
  status: DriverVehicle['status'];
  created_at: string | null;
};

function toVehicle(dto: DriverVehicleDto): DriverVehicle {
  return {
    id: dto.id,
    vehicleType: dto.vehicle_type,
    plate: dto.plate,
    vehicleModel: dto.vehicle_model,
    services: dto.services,
    status: dto.status,
    createdAt: dto.created_at,
  };
}

export type SwitchModeInput = { mode: UserRole; vehicleType?: VehicleType | null };

export const driverAccountRepository = {
  async listVehicles(signal?: AbortSignal): Promise<DriverVehicle[]> {
    const { data } = await api.get<DriverVehicleDto[]>('/drivers/me/vehicles', { signal });
    return data.map(toVehicle);
  },

  /** Registers (or updates) the vehicle of that type; returns it with the refreshed account. */
  async registerVehicle(
    input: DriverVehicleInput,
  ): Promise<{ user: User; vehicle: DriverVehicle }> {
    const { data } = await api.post<{ user: UserDto; vehicle: DriverVehicleDto }>(
      '/drivers/me/vehicles',
      {
        vehicle_type: input.vehicleType,
        plate: input.plate,
        vehicle_model: input.vehicleModel,
        services: input.services,
      },
    );
    return { user: toUser(data.user), vehicle: toVehicle(data.vehicle) };
  },

  async removeVehicle(vehicleType: VehicleType): Promise<User> {
    const { data } = await api.delete<UserDto>(`/drivers/me/vehicles/${vehicleType}`);
    return toUser(data);
  },

  /** Switches the active mode; `vehicleType` picks the vehicle to drive with. */
  async switchMode({ mode, vehicleType }: SwitchModeInput): Promise<User> {
    const { data } = await api.post<UserDto>('/drivers/me/mode', {
      mode,
      vehicle_type: vehicleType ?? null,
    });
    return toUser(data);
  },
};
