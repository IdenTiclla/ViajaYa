import { useRef, useState } from 'react';
import { useMutationState, useQueryClient } from '@tanstack/react-query';

import type { Offer } from '@/features/rides/domain/types';
import { AUTOMATIC_OFFER_KEY, useAutomaticOffer, type AutomaticOfferInput } from './useAutomaticOffer';

type OfferCallbacks = {
  onSuccess?: (offer: Offer) => void;
  onError?: (error: Error) => void;
};
type OfferAttempt = { input: AutomaticOfferInput; callbacks?: OfferCallbacks };
type FailedOffer = OfferAttempt & { error: Error };

/** Keep each submission independent, including callbacks for overlapping requests. */
export function useConcurrentOffers() {
  const { mutateAsync } = useAutomaticOffer();
  const queryClient = useQueryClient();
  const sharedPending = useMutationState({
    filters: { mutationKey: AUTOMATIC_OFFER_KEY, status: 'pending' },
    select: (mutation) => (mutation.state.variables as AutomaticOfferInput).rideId,
  });
  const pending = useRef(new Set<string>());
  const [localPending, setPendingRideIds] = useState<ReadonlySet<string>>(new Set());
  const pendingRideIds = new Set([...localPending, ...sharedPending]);
  const [failures, setFailures] = useState<Record<string, FailedOffer>>({});
  const dismissError = (rideId: string) => setFailures((current) => {
    const next = { ...current };
    delete next[rideId];
    return next;
  });

  const isRidePending = (rideId: string) => pending.current.has(rideId) || queryClient.isMutating({
    mutationKey: AUTOMATIC_OFFER_KEY,
    predicate: (mutation) => (mutation.state.variables as AutomaticOfferInput)?.rideId === rideId,
  }) > 0;

  const send = (input: AutomaticOfferInput, callbacks?: OfferCallbacks) => {
    if (isRidePending(input.rideId)) return;
    pending.current.add(input.rideId);
    setPendingRideIds(new Set(pending.current));
    dismissError(input.rideId);
    // Per-call mutate callbacks are replaced by later mutations in React Query.
    // Each promise retains its own ride and callbacks, even if responses reorder.
    void mutateAsync(input).then(
      (offer) => callbacks?.onSuccess?.(offer),
      (error: Error) => {
        setFailures((current) => ({ ...current, [input.rideId]: { input, callbacks, error } }));
        callbacks?.onError?.(error);
      },
    ).finally(() => {
      pending.current.delete(input.rideId);
      setPendingRideIds(new Set(pending.current));
    });
  };

  const errors = Object.values(failures);
  return {
    mutate: send,
    pendingRideIds,
    isRidePending,
    isPending: pendingRideIds.size > 0,
    isError: errors.length > 0,
    error: errors[0]?.error ?? null,
    failures: errors,
    dismissError,
    reset: () => setFailures({}),
  };
}
