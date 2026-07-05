/**
 * Perfil del conductor — datos de cuenta, vehículo y cierre de sesión.
 */
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { colors, fontSize, fontWeight, radius, spacing } from '@/core/theme';
import { Button } from '@/shared/components';
import { useAuthStore } from '@/store/authStore';

const SERVICE_LABELS = { taxi: 'Taxi', moto: 'Moto' } as const;

export function PerfilConductorScreen() {
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const signOut = useAuthStore((s) => s.signOut);
  const initial = (user?.fullName?.trim().charAt(0) ?? 'C').toUpperCase();

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.content}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>{initial}</Text>
        </View>
        <Text style={styles.name}>{user?.fullName ?? 'Conductor'}</Text>
        <Text style={styles.email}>{user?.email}</Text>
        {user?.rating != null && (
          <View style={styles.rating}>
            <Ionicons name="star" size={16} color={colors.accent} />
            <Text style={styles.ratingText}>{user.rating.toFixed(1)}</Text>
          </View>
        )}

        <View style={styles.vehicleCard}>
          <Detail
            icon={user?.vehicleType === 'moto' ? 'bicycle' : 'car-sport'}
            label="Vehículo"
            value={user?.vehicleType ? SERVICE_LABELS[user.vehicleType] : '—'}
          />
          <Detail icon="construct" label="Modelo" value={user?.vehicleModel ?? '—'} />
          <Detail icon="card" label="Placa" value={user?.plate ?? '—'} />
        </View>

        <View style={styles.actions}>
          <Button
            title="Historial de viajes"
            variant="secondary"
            onPress={() => router.navigate('/(driver)/(tabs)/historial')}
          />
          <Button title="Cerrar sesión" variant="secondary" onPress={() => void signOut()} />
        </View>
      </View>
    </SafeAreaView>
  );
}

function Detail({
  icon,
  label,
  value,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  value: string;
}) {
  return (
    <View style={styles.detailRow}>
      <Ionicons name={icon} size={20} color={colors.primary} />
      <Text style={styles.detailLabel}>{label}</Text>
      <Text style={styles.detailValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  content: { flex: 1, alignItems: 'center', padding: spacing.lg, gap: spacing.xs },
  avatar: {
    width: 88,
    height: 88,
    borderRadius: radius.pill,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: spacing.xl,
    marginBottom: spacing.sm,
  },
  avatarText: { color: colors.textOnPrimary, fontSize: fontSize.xxl, fontWeight: fontWeight.bold },
  name: { fontSize: fontSize.xl, fontWeight: fontWeight.bold, color: colors.text },
  email: { fontSize: fontSize.md, color: colors.textSecondary },
  rating: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, marginTop: spacing.xs },
  ratingText: { fontSize: fontSize.md, fontWeight: fontWeight.semibold, color: colors.text },

  vehicleCard: {
    alignSelf: 'stretch',
    marginTop: spacing.lg,
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  detailRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  detailLabel: { fontSize: fontSize.sm, color: colors.textSecondary, width: 80 },
  detailValue: { flex: 1, fontSize: fontSize.md, fontWeight: fontWeight.medium, color: colors.text },

  actions: { alignSelf: 'stretch', marginTop: 'auto', gap: spacing.sm },
});
