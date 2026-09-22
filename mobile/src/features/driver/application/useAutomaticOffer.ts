import { useMutation, useQueryClient } from '@tanstack/react-query';

import type { Coordinates, ServiceType } from '@/features/booking/domain/types';
import { fetchRoute } from '@/features/booking/data/routesService';
import { locationService } from '@/features/home/data/locationService';
import { arrivalMinutesFromSeconds } from '@/features/rides/domain/offerArrivalTime';
import { ridesRepository } from '@/features/rides/data/ridesRepository';
import type { CreateOfferInput } from '@/features/rides/domain/types';
import { useAuthStore } from '@/store/authStore';

export type AutomaticOfferInput = {
  rideId: string;
  riderName?: string;
  poolVersion: number;
  pickup: Coordinates;
  service: ServiceType;
  input: CreateOfferInput;
};

export const AUTOMATIC_OFFER_KEY = ['automatic-driver-offer'] as const;

/** Obtain a fresh pickup ETA before publishing any offer or counteroffer. */
export function useAutomaticOffer() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: AUTOMATIC_OFFER_KEY,
    mutationFn: async (vars: AutomaticOfferInput) => {
      const user = useAuthStore.getState().user;
      const origin = await locationService.getRoutingCoordinates();
      const profile = user?.vehicleType === 'moto' ? 'moto' : vars.service === 'moto' ? 'moto' : 'taxi';
      const route = await fetchRoute(origin, vars.pickup, profile);
      if (!route || !Number.isFinite(route.durationSeconds) || route.durationSeconds < 0) {
        throw new Error('No encontramos una ruta hasta el punto de recogida para tu vehículo. Intenta de nuevo o elige otra solicitud.');
      }
      const minutes = arrivalMinutesFromSeconds(route.durationSeconds);
      if (minutes === null) throw new Error('El punto de recogida está demasiado lejos para enviar esta oferta.');
      const current = useAuthStore.getState().user;
      if (current?.id !== user?.id || current?.vehicleType !== user?.vehicleType) {
        throw new Error('Cambiaste de vehículo o de sesión. Vuelve a seleccionar la solicitud.');
      }
      return ridesRepository.createOffer(vars.rideId, { ...vars.input, etaMin: minutes, expectedPoolVersion: vars.poolVersion });
    },
    onError: () => { void queryClient.invalidateQueries({ queryKey: ['open-rides'] }); },
    onSuccess: () => { void queryClient.invalidateQueries({ queryKey: ['driver-active-ride'] }); },
  });
}
