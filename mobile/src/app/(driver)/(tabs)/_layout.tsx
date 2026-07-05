import { Ionicons } from '@expo/vector-icons';
import { Tabs } from 'expo-router/js-tabs';

import { PillTabBar } from '@/core/components/PillTabBar';

/**
 * Navegación principal del conductor: Solicitudes / Historial / Ganancias / Perfil.
 *
 * El tab activo lleva el pill amarillo Stitch (ver PillTabBar). "Solicitudes" es
 * la pantalla inicial al ingresar (redirect en app/index.tsx). "index" queda como
 * redirect oculto (`tabBarButton: () => null`) del segmento base hacia Solicitudes.
 */
export default function DriverTabsLayout() {
  return (
    <Tabs tabBar={(props) => <PillTabBar {...props} />} screenOptions={{ headerShown: false }}>
      <Tabs.Screen name="index" options={{ tabBarButton: () => null }} />
      <Tabs.Screen
        name="solicitudes"
        options={{
          title: 'Solicitudes',
          tabBarIcon: ({ color, size }) => <Ionicons name="list" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="historial"
        options={{
          title: 'Historial',
          tabBarIcon: ({ color, size }) => <Ionicons name="time" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="ganancias"
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
