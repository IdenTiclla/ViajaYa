import { Ionicons } from '@react-native-vector-icons/ionicons';
import { Tabs } from 'expo-router/js-tabs';

import { DriverTabBar } from '@/features/driver/presentation/DriverTabBar';

/**
 * Driver's main navigation: Solicitudes / Historial / Ganancias / Perfil.
 *
 * The active tab carries the Stitch yellow pill (see PillTabBar). "Solicitudes" is
 * the initial screen on entry (redirect in app/index.tsx). "index" stays as a
 * hidden redirect (`tabBarButton: () => null`) from the base segment to Solicitudes.
 * The bar hides while a ride is in its flow (see DriverTabBar).
 */
export default function DriverTabsLayout() {
  return (
    <Tabs tabBar={(props) => <DriverTabBar {...props} />} screenOptions={{ headerShown: false }}>
      <Tabs.Screen name="index" options={{ tabBarButton: () => null }} />
      <Tabs.Screen
        name="requests"
        options={{
          title: 'Solicitudes',
          tabBarIcon: ({ color, size }) => <Ionicons name="list" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="history"
        options={{
          title: 'Historial',
          tabBarIcon: ({ color, size }) => <Ionicons name="time" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="earnings"
        options={{
          title: 'Ganancias',
          tabBarIcon: ({ color, size }) => <Ionicons name="cash" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: 'Perfil',
          tabBarIcon: ({ color, size }) => <Ionicons name="person" size={size} color={color} />,
        }}
      />
    </Tabs>
  );
}
