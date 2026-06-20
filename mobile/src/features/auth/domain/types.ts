/** Tipos del dominio de autenticación (independientes del transporte HTTP). */

export type AuthProvider = 'local' | 'google' | 'facebook';

export type UserRole = 'passenger' | 'driver';

/** Tipo de vehículo del conductor (coincide con `ServiceType` del booking). */
export type VehicleType = 'taxi' | 'moto';

export type User = {
  id: string;
  fullName: string;
  email: string;
  phone: string | null;
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

export type RegisterPayload = {
  fullName: string;
  email: string;
  password: string;
  phone?: string;
};

export type LoginPayload = {
  email: string;
  password: string;
};

/** Puerto de datos de auth. La implementación HTTP vive en `data/`. */
export interface AuthRepository {
  register(payload: RegisterPayload): Promise<AuthResult>;
  login(payload: LoginPayload): Promise<AuthResult>;
  oauth(provider: Exclude<AuthProvider, 'local'>, token: string): Promise<AuthResult>;
  me(): Promise<User>;
}
