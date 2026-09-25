/**
 * Driver bottom bar: the shared PillTabBar, hidden while a ride is in its
 * flow (pickup → travel → closing rating) so the driver stays focused on it.
 *
 * The ride flow is rendered inside the Requests tab, so if a ride becomes
 * active while the driver is on another tab (e.g. Profile), it moves them back
 * to Requests; without the bar they could not get there otherwise.
 */
import type { BottomTabBarProps } from 'expo-router/js-tabs';
import { useEffect } from 'react';

import { PillTabBar } from '@/core/components/PillTabBar';
import {
  useDriverActiveRide,
  usePendingRatingRide,
} from '@/features/rides/application/useRides';

const RIDE_FLOW_TAB = 'requests';

export function DriverTabBar(props: BottomTabBarProps) {
  const { state, navigation } = props;
  // Same queries (and cache keys) that IncomingRequestsScreen uses to decide
  // whether to render the ride flow instead of the requests pool.
  const activeRide = useDriverActiveRide().ride;
  const pendingRatingRide = usePendingRatingRide().ride;
  const inRideFlow = activeRide != null || pendingRatingRide != null;
  const currentTab = state.routes[state.index]?.name;

  useEffect(() => {
    if (inRideFlow && currentTab !== RIDE_FLOW_TAB) {
      navigation.navigate(RIDE_FLOW_TAB);
    }
  }, [currentTab, inRideFlow, navigation]);

  if (inRideFlow) return null;
  return <PillTabBar {...props} />;
}
