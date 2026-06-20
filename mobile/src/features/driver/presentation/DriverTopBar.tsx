/**
 * Top bar translúcida (glass) del conductor, común a la pantalla de "buscando
 * viajes" y a la lista de solicitudes: pill de disponibilidad ONLINE /
 * DESCONECTADO (toggle controlado por el padre, que hace la mutación optimista
 * vía `POST /drivers/me/online`) y a la derecha el rating + vehículo.
 *
 * Flota sobre el mapa (`pointerEvents="box-none"` en el contenedor externo) o se
 * acomoda como cabecera en la vista de lista.
 */
import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { colors, fontSize, fontWeight, radius, spacing } from '@/core/theme';
import { useAuthStore } from '@/store/authStore';

const SERVICE_LABELS = { taxi: 'Taxi', moto: 'Moto' } as const;

export function DriverTopBar({
  online,
  pending,
  onToggle,
}: {
  online: boolean;
  pending: boolean;
  onToggle: (next: boolean) => void;
}) {
  const user = useAuthStore((s) => s.user);

  const vehicle = [
    user?.vehicleType ? SERVICE_LABELS[user.vehicleType] : null,
    user?.vehicleModel,
    user?.plate,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <SafeAreaView edges={['top']} style={styles.wrap} pointerEvents="box-none">
      <View style={styles.bar}>
        <TouchableOpacity
          style={[styles.pill, online ? styles.pillOnline : styles.pillOffline]}
          onPress={() => onToggle(!online)}
          disabled={pending}
          accessibilityRole="switch"
          accessibilityState={{ checked: online }}
          accessibilityLabel={
            online ? 'En línea. Toca para desconectarte' : 'Desconectado. Toca para conectarte'
          }>
          <View
            style={[styles.dot, { backgroundColor: online ? colors.surface : colors.textSecondary }]}
          />
          <Text style={[styles.pillText, online ? styles.pillTextOnline : styles.pillTextOffline]}>
            {online ? 'EN LÍNEA' : 'DESCONECTADO'}
          </Text>
        </TouchableOpacity>

        <View style={styles.profile} pointerEvents="none">
          {user?.rating != null && (
            <View style={styles.rating}>
              <Ionicons name="star" size={12} color={colors.accent} />
              <Text style={styles.ratingText}>{user.rating.toFixed(1)}</Text>
            </View>
          )}
          {!!vehicle && (
            <Text style={styles.vehicle} numberOfLines={1}>
              {vehicle}
            </Text>
          )}
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingHorizontal: spacing.md },
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    backgroundColor: 'rgba(255,255,255,0.85)',
    borderWidth: 1,
    borderColor: 'rgba(226,228,232,0.7)',
    shadowColor: '#000',
    shadowOpacity: 0.12,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs + 2,
    borderRadius: radius.pill,
  },
  pillOnline: { backgroundColor: colors.success },
  pillOffline: { backgroundColor: colors.surfaceMuted },
  dot: { width: 8, height: 8, borderRadius: radius.pill },
  pillText: { fontSize: fontSize.xs, fontWeight: fontWeight.bold, letterSpacing: 0.5 },
  pillTextOnline: { color: colors.textOnPrimary },
  pillTextOffline: { color: colors.textSecondary },
  profile: { flex: 1, alignItems: 'flex-end' },
  rating: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  ratingText: { fontSize: fontSize.xs, fontWeight: fontWeight.bold, color: colors.text },
  vehicle: { fontSize: 10, color: colors.textSecondary, marginTop: 1 },
});
