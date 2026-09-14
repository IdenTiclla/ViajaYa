/** Mutations for the driver application and the passenger/driver mode switch. */
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';

import type { UserRole } from '@/features/auth/domain/types';
import {
  driverAccountRepository,
  type DriverApplicationInput,
} from '@/features/driver/data/driverAccountRepository';
import { useAuthStore } from '@/store/authStore';

export function useApplyAsDriver() {
  const setUser = useAuthStore((s) => s.setUser);
  return useMutation({
    mutationFn: (input: DriverApplicationInput) => driverAccountRepository.apply(input),
    onSuccess: (user) => setUser(user),
  });
}

/**
 * Switches the active mode. The root guards re-route by `user.role`, so the
 * server state of the previous mode is dropped and navigation restarts at "/".
 */
export function useSwitchAccountMode() {
  const queryClient = useQueryClient();
  const router = useRouter();
  const setUser = useAuthStore((s) => s.setUser);
  return useMutation({
    mutationFn: (mode: UserRole) => driverAccountRepository.switchMode(mode),
    onSuccess: (user) => {
      queryClient.removeQueries();
      setUser(user);
      router.replace('/');
    },
  });
}
