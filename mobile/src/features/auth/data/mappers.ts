/** Mapeo entre el contrato HTTP (snake_case) y los tipos del dominio. */
import type { AuthResult, AuthTokens, User } from '@/features/auth/domain/types';

type UserDto = {
  id: string;
  full_name: string;
  email: string;
  phone: string | null;
  auth_provider: User['authProvider'];
  role: User['role'];
  vehicle_type: User['vehicleType'];
  plate: string | null;
  vehicle_model: string | null;
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
  return {
    id: dto.id,
    fullName: dto.full_name,
    email: dto.email,
    phone: dto.phone,
    authProvider: dto.auth_provider,
    role: dto.role,
    vehicleType: dto.vehicle_type,
    plate: dto.plate,
    vehicleModel: dto.vehicle_model,
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
