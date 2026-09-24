/** Authentication domain types (independent of the HTTP transport). */
import type { ServiceType } from '@/features/booking/domain/types';

export type AuthProvider = 'local' | 'google' | 'facebook';

/** Active mode of the account; an approved driver switches between both. */
export type UserRole = 'passenger' | 'driver';

/** The driver's physical vehicle; one vehicle can serve several services. */
export type VehicleType = 'taxi' | 'moto' | 'truck';

/** Outcome of the driver application; only `approved` may enter driver mode. */
export type DriverStatus = 'pending' | 'approved' | 'rejected';

export type User = {
  id: string;
  fullName: string;
  email: string | null;
  phone: string | null;
  phoneVerifiedAt: string | null;
  authProvider: AuthProvider;
  role: UserRole;
  /** Driver application: vehicle, chosen services and review status (null = never applied). */
  vehicleType: VehicleType | null;
  plate: string | null;
  vehicleModel: string | null;
  driverServices: ServiceType[];
  driverStatus: DriverStatus | null;
  rating: number | null;
  isOnline: boolean;
  createdAt: string | null;
};

export type AuthTokens = {
  accessToken: string;
  refreshToken: string;
};

export type AuthResult = {
  user: User;
  tokens: AuthTokens;
};

/** Session data port; sign-in itself lives in `PhoneAccessRepository`. */
export interface AuthRepository {
  me(): Promise<User>;
}
