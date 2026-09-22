import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ridesRepository, type CreateRideInput } from '../data/ridesRepository';
import { ridesRepository as lifecycleRepository } from '@/features/rides/data/ridesRepository';
import { recoverCommittedMutation } from '@/features/rides/application/recoverCommittedMutation';
import { PASSENGER_ACTIVE_RIDE_KEY } from '@/features/rides/application/useRides';

export function useCreateRide() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateRideInput) => recoverCommittedMutation(
      () => ridesRepository.create(input),
      () => lifecycleRepository.getPassengerActiveRide(),
      () => true,
    ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['recent-destinations'] });
      void queryClient.invalidateQueries({ queryKey: PASSENGER_ACTIVE_RIDE_KEY });
    },
  });
}
