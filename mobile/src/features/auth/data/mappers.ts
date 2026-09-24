/** Mapping between the HTTP contract (snake_case) and the domain types. */
import type { AuthResult, AuthTokens, User } from '@/features/auth/domain/types';
import type { ServiceType } from '@/features/booking/domain/types';

type UserDto = {
  id: string;
  full_name: string;
  email: string | null;
  phone: string | null;
  phone_verified_at?: string | null;
  auth_provider: User['authProvider'];
  role: User['role'] | 'delivery';
  vehicle_type: User['vehicleType'];
  plate: string | null;
  vehicle_model: string | null;
  driver_services?: ServiceType[];
  driver_status?: User['driverStatus'];
  rating: number | null;
  is_online: boolean;
  created_at: string | null;
};

type TokenDto = {
  access_token: string;
  refresh_token: string;
};

export type AuthResponseDto = { user: UserDto; tokens: TokenDto };

export function toUser(dto: UserDto): User {
  if (dto.role === 'delivery') throw new Error('El acceso de reparto aún no está habilitado en esta app.');
  return {
    id: dto.id,
    fullName: dto.full_name,
    email: dto.email,
    phone: dto.phone,
    phoneVerifiedAt: dto.phone_verified_at ?? null,
    authProvider: dto.auth_provider,
    role: dto.role,
    vehicleType: dto.vehicle_type,
    plate: dto.plate,
    vehicleModel: dto.vehicle_model,
    driverServices: dto.driver_services ?? [],
    driverStatus: dto.driver_status ?? null,
    rating: dto.rating,
    isOnline: dto.is_online,
    createdAt: dto.created_at,
  };
}

export function toTokens(dto: TokenDto): AuthTokens {
  return { accessToken: dto.access_token, refreshToken: dto.refresh_token };
}

export function toAuthResult(dto: AuthResponseDto): AuthResult {
  return { user: toUser(dto.user), tokens: toTokens(dto.tokens) };
}
