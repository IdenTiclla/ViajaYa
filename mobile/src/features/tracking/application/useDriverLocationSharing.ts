import { useEffect } from 'react';
import { AppState } from 'react-native';
import { useAuthStore } from '@/store/authStore';
import { useDriverActiveRide } from '@/features/rides/application/useRides';
import { canTrackRide } from '../domain/driverLocation';
import { startSharing, stopSharing } from './driverLocationTask';

export function useDriverLocationSharing() {
  const userId = useAuthStore(s => s.user?.id);
  const { ride } = useDriverActiveRide();
  const rideId = canTrackRide(ride) ? ride?.id : null;
  useEffect(() => {
    if (!rideId || !userId) { void stopSharing(); return; }
    const start = () => { void startSharing({ rideId, userId }); };
    start();
    const listener = AppState.addEventListener('change', state => { if (state === 'active') start(); });
    return () => { listener.remove(); void stopSharing(); };
  }, [rideId, userId]);
}
