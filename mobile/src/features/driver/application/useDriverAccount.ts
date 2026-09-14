/** Driver vehicles (list/register/remove) and the passenger/driver mode switch. */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';

import type { VehicleType } from '@/features/auth/domain/types';
import {
  driverAccountRepository,
  type SwitchModeInput,
} from '@/features/driver/data/driverAccountRepository';
import type { DriverVehicle, DriverVehicleInput } from '@/features/driver/domain/types';
import { useDriverRequests } from '@/features/driver/application/useDriverRequests';
import { ridesRepository } from '@/features/rides/data/ridesRepository';
import { useAuthStore } from '@/store/authStore';

export const DRIVER_VEHICLES_KEY = ['driver-vehicles'] as const;

export function useDriverVehicles(enabled = true) {
  return useQuery({
    queryKey: DRIVER_VEHICLES_KEY,
    queryFn: ({ signal }) => driverAccountRepository.listVehicles(signal),
    enabled,
  });
}

export function approvedVehicles(vehicles: DriverVehicle[] | undefined): DriverVehicle[] {
  return (vehicles ?? []).filter((vehicle) => vehicle.status === 'approved');
}

export function useRegisterDriverVehicle() {
  const queryClient = useQueryClient();
  const setUser = useAuthStore((s) => s.setUser);
  return useMutation({
    mutationFn: (input: DriverVehicleInput) => driverAccountRepository.registerVehicle(input),
    onSuccess: ({ user }) => {
      setUser(user);
      void queryClient.invalidateQueries({ queryKey: DRIVER_VEHICLES_KEY });
    },
  });
}

export function useRemoveDriverVehicle() {
  const queryClient = useQueryClient();
  const setUser = useAuthStore((s) => s.setUser);
  return useMutation({
    mutationFn: (vehicleType: VehicleType) => driverAccountRepository.removeVehicle(vehicleType),
    onSuccess: (user) => {
      setUser(user);
      void queryClient.invalidateQueries({ queryKey: DRIVER_VEHICLES_KEY });
    },
  });
}

/**
 * Switches the active mode and/or the vehicle to drive with. A driver who is
 * online first goes offline (the backend refuses the change otherwise). The
 * root guards re-route by `user.role`, so the server state of the previous
 * mode is dropped and navigation restarts at "/".
 */
export function useSwitchAccountMode() {
  const queryClient = useQueryClient();
  const router = useRouter();
  const setUser = useAuthStore((s) => s.setUser);
  const resolveModeChoice = useAuthStore((s) => s.resolveModeChoice);
  return useMutation({
    mutationFn: async (input: SwitchModeInput) => {
      if (useAuthStore.getState().user?.isOnline) {
        await ridesRepository.setOnline(false);
        // The HTTP commit already withdrew live offers even if the WS notice is lost.
        const driverRequests = useDriverRequests.getState();
        driverRequests.invalidateAllOfferAttempts();
        driverRequests.reconcileOffered([]);
      }
      return driverAccountRepository.switchMode(input);
    },
    onSuccess: (user) => {
      queryClient.removeQueries();
      setUser(user);
      resolveModeChoice();
      router.replace('/');
    },
  });
}
