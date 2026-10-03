/**
 * Confirmation shown when the passenger accepts an offer (the ride was
 * assigned): a full-screen "¡Viaje confirmado!" with the driver and plate
 * that opens stage 2. It advances on the button (after ~500 ms, to avoid an
 * accidental touch) or, as a fallback, on its own after a few seconds.
 */
import { useEffect, useRef } from 'react';
import { StyleSheet, View } from 'react-native';

import type { Ride } from '@/features/rides/domain/types';
import { RideConfirmedScreen } from '@/features/rides/presentation/RideConfirmedScreen';

const MIN_DISPLAY_MS = 500;
const FALLBACK_MS = 6000;

export function ConfirmationOverlay({
  visible,
  ride,
  onDone,
}: {
  visible: boolean;
  ride: Ride | null;
  onDone: () => void;
}) {
  const canDismissRef = useRef(false);

  useEffect(() => {
    if (!visible) return;
    canDismissRef.current = false;
    const minTimer = setTimeout(() => {
      canDismissRef.current = true;
    }, MIN_DISPLAY_MS);
    const fallback = setTimeout(onDone, FALLBACK_MS);
    return () => {
      clearTimeout(minTimer);
      clearTimeout(fallback);
    };
    // visible starts the timers; onDone is stable (useCallback in the parent).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  if (!visible) return null;

  return (
    <View style={styles.overlay}>
      <RideConfirmedScreen
        ride={ride}
        role="passenger"
        actionLabel="Ver a mi conductor"
        onContinue={() => {
          if (canDismissRef.current) onDone();
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: { ...StyleSheet.absoluteFill, zIndex: 100 },
});
