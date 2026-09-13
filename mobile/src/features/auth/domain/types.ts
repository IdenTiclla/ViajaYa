/** Tipos del dominio de autenticación (independientes del transporte HTTP). */

export type AuthProvider = 'local' | 'google' | 'facebook';

export type UserRole = 'passenger' | 'driver';

/** Vehiculo fisico del conductor; un mismo vehiculo puede atender varios servicios. */
export type VehicleType = 'taxi' | 'moto';

export type User = {
  id: string;
  fullName: string;
  email: string | null;
  phone: string | null;
  phoneVerifiedAt: string | null;
  authProvider: AuthProvider;
  role: UserRole;
  /** Solo conductores: tipo de vehículo y datos del mismo. */
  vehicleType: VehicleType | null;
  plate: string | null;
  vehicleModel: string | null;
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
