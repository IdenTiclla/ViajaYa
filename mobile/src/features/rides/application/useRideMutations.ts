/**
 * Mutaciones del flujo de viaje (ofertar, aceptar, avanzar estado, cancelar,
 * disponibilidad del conductor). Tras cada mutación se invalidan las consultas
 * afectadas para que el polling refleje el nuevo estado de inmediato.
 */
import { useMutation, useQueryClient } from '@tanstack/react-query';

import { ridesRepository } from '@/features/rides/data/ridesRepository';
import type { CreateOfferInput, EditRideInput, RideStatus } from '@/features/rides/domain/types';

/** Conductor: oferta sobre una solicitud (aceptar al precio o contraofertar). */
export function useCreateOffer() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (vars: { rideId: string; input: CreateOfferInput }) =>
      ridesRepository.createOffer(vars.rideId, vars.input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['driver-active-ride'] });
    },
  });
}

/**
 * Pasajero: acepta una oferta y le asigna el viaje (decisión final). El backend
 * devuelve el viaje ya asignado; se refleja al instante en la caché del viaje.
 */
export function useAcceptOffer() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (offerId: string) => ridesRepository.acceptOffer(offerId),
    onSuccess: (ride) => {
      queryClient.setQueryData(['ride', ride.id], ride);
    },
  });
}

/** Conductor: retira su oferta (o se niega a confirmar una aceptada). */
export function useWithdrawOffer() {
  return useMutation({
    mutationFn: (offerId: string) => ridesRepository.withdrawOffer(offerId),
  });
}

/** Pasajero: rechaza una oferta concreta (sin asignar conductor). */
export function useRejectOffer() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (vars: { offerId: string; rideId: string }) =>
      ridesRepository.rejectOffer(vars.offerId),
    onSuccess: (_data, vars) => {
      void queryClient.invalidateQueries({ queryKey: ['ride-offers', vars.rideId] });
    },
  });
}

/** Conductor: avanza el estado del viaje (llegué → iniciar → finalizar). */
export function useUpdateRideStatus() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (vars: { rideId: string; status: RideStatus }) =>
      ridesRepository.updateStatus(vars.rideId, vars.status),
    onSuccess: (ride) => {
      void queryClient.invalidateQueries({ queryKey: ['ride', ride.id] });
      void queryClient.invalidateQueries({ queryKey: ['driver-active-ride'] });
    },
  });
}

/** Cancela el viaje (pasajero o conductor asignado). */
export function useCancelRide() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (rideId: string) => ridesRepository.cancel(rideId),
    onSuccess: (ride) => {
      void queryClient.invalidateQueries({ queryKey: ['ride', ride.id] });
      void queryClient.invalidateQueries({ queryKey: ['driver-active-ride'] });
    },
  });
}

/**
 * Pasajero: aumenta la oferta de la solicitud en búsqueda. Actualiza la caché
 * del detalle del viaje al instante; los conductores ven el nuevo monto en vivo
 * por WebSocket (el backend reanuncia la solicitud al pool).
 */
export function useUpdateRideFare() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (vars: { rideId: string; fare: number }) =>
      ridesRepository.updateFare(vars.rideId, vars.fare),
    onSuccess: (ride) => {
      queryClient.setQueryData(['ride', ride.id], ride);
    },
  });
}

/** Conductor: alterna su disponibilidad (en línea/desconectado). */
export function useSetOnline() {
  return useMutation({
    mutationFn: (isOnline: boolean) => ridesRepository.setOnline(isOnline),
  });
}

/** Pasajero: pausa la solicitud para editarla (Modificar solicitud). */
export function usePauseForEdit() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (rideId: string) => ridesRepository.pauseForEdit(rideId),
    onSuccess: (ride) => {
      queryClient.setQueryData(['ride', ride.id], ride);
      void queryClient.invalidateQueries({ queryKey: ['ride-offers', ride.id] });
    },
  });
}

/** Pasajero: guarda los cambios de una solicitud pausada y la vuelve a publicar. */
export function useEditRide() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (vars: { rideId: string; input: EditRideInput }) =>
      ridesRepository.editRide(vars.rideId, vars.input),
    onSuccess: (ride) => {
      queryClient.setQueryData(['ride', ride.id], ride);
      void queryClient.invalidateQueries({ queryKey: ['ride-offers', ride.id] });
      void queryClient.invalidateQueries({ queryKey: ['open-rides'] });
    },
  });
}
