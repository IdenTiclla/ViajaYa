/**
 * Inicio del conductor — disponibilidad y resumen.
 *
 * Toggle En línea/Desconectado (`POST /drivers/me/online`), datos del vehículo y
 * un acceso al viaje activo si el conductor ya fue elegido (polling).
 */
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, Switch, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { colors, fontSize, fontWeight, radius, spacing } from '@/core/theme';
import { useDriverEarnings } from '@/features/rides/application/useCloseFlow';
import { useSetOnline } from '@/features/rides/application/useRideMutations';
import { useDriverActiveRide } from '@/features/rides/application/useRides';
import { useAuthStore } from '@/store/authStore';

const SERVICE_LABELS = { taxi: 'Taxi', moto: 'Moto' } as const;

export function InicioConductorScreen() {
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const [online, setOnline] = useState(user?.isOnline ?? false);
  const setOnlineMutation = useSetOnline();
  const { ride: activeRide } = useDriverActiveRide();
  const { data: earnings } = useDriverEarnings();

  const toggle = (next: boolean) => {
    setOnline(next); // optimista
    setOnlineMutation.mutate(next, {
      onSuccess: (value) => setOnline(value),
      onError: () => setOnline(!next), // revierte si falla
    });
  };

  const vehicle = [
    user?.vehicleType ? SERVICE_LABELS[user.vehicleType] : null,
    user?.vehicleModel,
    user?.plate,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <SafeAreaView style={styles.root}>
      <View style={styles.content}>
        <Text style={styles.greeting}>Hola, {user?.fullName?.split(' ')[0] ?? 'conductor'}</Text>
        {!!vehicle && <Text style={styles.vehicle}>{vehicle}</Text>}

        <View style={styles.statusCard}>
          <View style={styles.statusInfo}>
            <View style={[styles.dot, { backgroundColor: online ? colors.success : colors.border }]} />
            <View>
              <Text style={styles.statusLabel}>{online ? 'En línea' : 'Desconectado'}</Text>
              <Text style={styles.statusHint}>
                {online ? 'Recibirás solicitudes de viaje.' : 'Activa para recibir solicitudes.'}
              </Text>
            </View>
          </View>
          <Switch
            value={online}
            onValueChange={toggle}
            disabled={setOnlineMutation.isPending}
            trackColor={{ true: colors.primary, false: colors.border }}
            accessibilityLabel="Disponibilidad en línea"
          />
        </View>

        {activeRide && (
          <TouchableOpacity
            style={styles.activeBanner}
            onPress={() => router.navigate('/(driver)/(tabs)/solicitudes')}
            accessibilityRole="button"
            accessibilityLabel="Ver viaje activo">
            <Ionicons name="car-sport" size={22} color={colors.primary} />
            <Text style={styles.activeText}>Tienes un viaje activo · toca para gestionarlo</Text>
            <Ionicons name="chevron-forward" size={20} color={colors.textSecondary} />
          </TouchableOpacity>
        )}

        <View style={styles.statsRow}>
          <Stat
            icon="cash-outline"
            label="Ganancias hoy"
            value={earnings ? `Bs ${earnings.totalToday.toFixed(2)}` : '—'}
          />
          <Stat
            icon="car-outline"
            label="Viajes hoy"
            value={earnings ? String(earnings.tripsToday) : '—'}
          />
        </View>
      </View>
    </SafeAreaView>
  );
}

function Stat({
  icon,
  label,
  value,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  value: string;
}) {
  return (
    <View style={styles.stat}>
      <Ionicons name={icon} size={22} color={colors.primary} />
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.lg, gap: spacing.md },
  greeting: { fontSize: fontSize.xl, fontWeight: fontWeight.bold, color: colors.text, marginTop: spacing.sm },
  vehicle: { fontSize: fontSize.sm, color: colors.textSecondary },

  statusCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    marginTop: spacing.sm,
  },
  statusInfo: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  dot: { width: 12, height: 12, borderRadius: radius.pill },
  statusLabel: { fontSize: fontSize.md, fontWeight: fontWeight.semibold, color: colors.text },
  statusHint: { fontSize: fontSize.sm, color: colors.textSecondary },

  activeBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceMuted,
  },
  activeText: { flex: 1, fontSize: fontSize.sm, fontWeight: fontWeight.medium, color: colors.text },

  statsRow: { flexDirection: 'row', gap: spacing.md, marginTop: spacing.sm },
  stat: {
    flex: 1,
    alignItems: 'center',
    gap: spacing.xs,
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceMuted,
  },
  statValue: { fontSize: fontSize.lg, fontWeight: fontWeight.bold, color: colors.text },
  statLabel: { fontSize: fontSize.xs, color: colors.textSecondary },
});
