/**
 * Perfil del conductor — datos de cuenta, vehículo y cierre de sesión.
 */
import { Ionicons, type IoniconsIconName } from '@react-native-vector-icons/ionicons';
import { useRouter } from 'expo-router';
import { ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { fontSize, fontWeight, radius, spacing, useEstilos, type Tema } from '@/core/theme';
import { Button } from '@/shared/components';
import { useAuthStore } from '@/store/authStore';
import { SelectorTema } from '@/features/profile/presentation/SelectorTema';

const SERVICE_LABELS = { taxi: 'Taxi', moto: 'Moto' } as const;

export function PerfilConductorScreen() {
  const { colors, styles } = useEstilos(crearEstilos);
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const signOut = useAuthStore((s) => s.signOut);
  const initial = (user?.fullName?.trim().charAt(0) ?? 'C').toUpperCase();

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView contentContainerStyle={styles.content}>
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

        <SelectorTema />
        <View style={styles.actions}>
          <Button
            title="Historial de viajes"
            variant="secondary"
            onPress={() => router.navigate('/(driver)/(tabs)/historial')}
          />
          <Button title="Cerrar sesión" variant="secondary" onPress={() => void signOut()} />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function Detail({
  icon,
  label,
  value,
}: {
  icon: IoniconsIconName;
  label: string;
  value: string;
}) {
  const { colors, styles } = useEstilos(crearEstilos);
  const { fontScale } = useWindowDimensions();
  const enColumna = fontScale > 1.3;
  return (
    <View style={[styles.detailRow, enColumna && styles.detailColumn]}>
      {!enColumna && <Ionicons accessible={false} name={icon} size={20} color={colors.primary} />}
      <Text style={[styles.detailLabel, enColumna && styles.detailFullWidth]}>{label}</Text>
      <Text style={[styles.detailValue, enColumna && styles.detailFullWidth]}>{value}</Text>
    </View>
  );
}

const crearEstilos = ({ colors }: Tema) => StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  content: { flexGrow: 1, alignItems: 'center', padding: spacing.lg, gap: spacing.xs },
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
  name: { maxWidth: '100%', fontSize: fontSize.xl, fontWeight: fontWeight.bold, color: colors.text, textAlign: 'center' },
  email: { maxWidth: '100%', fontSize: fontSize.md, color: colors.textSecondary, textAlign: 'center' },
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
  detailColumn: { flexDirection: 'column', alignItems: 'flex-start', gap: spacing.xs },
  detailFullWidth: { flex: 0, width: '100%' },
  detailLabel: { fontSize: fontSize.sm, color: colors.textSecondary, width: 80 },
  detailValue: { flex: 1, fontSize: fontSize.md, fontWeight: fontWeight.medium, color: colors.text },

  actions: { alignSelf: 'stretch', marginTop: spacing.lg, gap: spacing.sm },
});
