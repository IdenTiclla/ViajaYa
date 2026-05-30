/**
 * Búsqueda de ofertas — pantalla puente tras "Buscar Ofertas".
 *
 * Muestra el resumen del viaje y un estado de "buscando conductores". La lista
 * real de ofertas (aceptar/rechazar, perfiles de conductor) es la siguiente
 * entrega; aquí se confirma que la solicitud quedó armada de extremo a extremo.
 */
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { colors, fontSize, fontWeight, radius, spacing } from '@/core/theme';
import { useBookingStore } from '@/features/booking/application/useBookingStore';

const SERVICE_LABELS = { taxi: 'Taxi', moto: 'Moto' } as const;
const PAYMENT_LABELS = { qr: 'Pago por QR', cash: 'Pago en efectivo' } as const;

export function OffersScreen() {
  const router = useRouter();
  const origin = useBookingStore((s) => s.origin);
  const destination = useBookingStore((s) => s.destination);
  const service = useBookingStore((s) => s.service);
  const payment = useBookingStore((s) => s.payment);
  const fare = useBookingStore((s) => s.fare);

  return (
    <SafeAreaView style={styles.root}>
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.back}
          onPress={() => router.back()}
          accessibilityRole="button"
          accessibilityLabel="Volver">
          <Ionicons name="arrow-back" size={24} color={colors.text} />
        </TouchableOpacity>
        <Text style={styles.title}>Buscando ofertas</Text>
        <View style={styles.back} />
      </View>

      <View style={styles.summary}>
        <SummaryRow icon="navigate-circle" text={origin?.name ?? 'Origen'} color={colors.primary} />
        <SummaryRow icon="location" text={destination?.name ?? 'Destino'} color={colors.danger} />
        <View style={styles.meta}>
          <Text style={styles.metaText}>{SERVICE_LABELS[service]}</Text>
          <Text style={styles.metaDot}>·</Text>
          <Text style={styles.metaText}>{PAYMENT_LABELS[payment]}</Text>
          <Text style={styles.metaDot}>·</Text>
          <Text style={styles.metaText}>Tu oferta: Bs {fare || '—'}</Text>
        </View>
      </View>

      <View style={styles.center}>
        <ActivityIndicator size="large" color={colors.primary} />
        <Text style={styles.centerTitle}>Buscando conductores cercanos…</Text>
        <Text style={styles.centerSubtitle}>
          Te mostraremos las ofertas de los conductores en cuanto respondan.
        </Text>
      </View>
    </SafeAreaView>
  );
}

function SummaryRow({
  icon,
  text,
  color,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  text: string;
  color: string;
}) {
  return (
    <View style={styles.summaryRow}>
      <Ionicons name={icon} size={20} color={color} />
      <Text style={styles.summaryText} numberOfLines={1}>
        {text}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  back: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: fontSize.md, fontWeight: fontWeight.semibold, color: colors.text },

  summary: {
    marginHorizontal: spacing.lg,
    padding: spacing.md,
    gap: spacing.sm,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceMuted,
  },
  summaryRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  summaryText: { flex: 1, fontSize: fontSize.md, color: colors.text },
  meta: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.xs },
  metaText: { fontSize: fontSize.sm, color: colors.textSecondary },
  metaDot: { color: colors.textSecondary },

  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.sm, padding: spacing.xl },
  centerTitle: { fontSize: fontSize.md, fontWeight: fontWeight.semibold, color: colors.text, textAlign: 'center' },
  centerSubtitle: { fontSize: fontSize.sm, color: colors.textSecondary, textAlign: 'center' },
});
