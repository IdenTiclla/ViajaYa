/** HTTP implementation of the `AuthRepository` port (shared axios client). */
import { api } from '@/core/http/client';
import type { AuthRepository, User } from '@/features/auth/domain/types';

import { toUser } from './mappers';

export const authRepository: AuthRepository = {
  async me(): Promise<User> {
    const { data } = await api.get('/auth/me');
    return toUser(data);
  },
};
