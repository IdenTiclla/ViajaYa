/**
 * Ganancias del conductor — datos reales desde `GET /drivers/me/earnings`.
 *
 * Muestra el total de hoy, contadores y el desglose de viajes completados
 * recientes con su importe.
 */
import { Ionicons } from '@expo/vector-icons';
import { ActivityIndicator, FlatList, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { colors, fontSize, fontWeight, radius, spacing } from '@/core/theme';
import { useDriverEarnings } from '@/features/rides/application/useCloseFlow';
import { formatBolivianos } from '@/features/rides/domain/money';
import type { EarningsItem } from '@/features/rides/domain/types';

function formatDate(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleDateString('es-BO', { day: '2-digit', month: 'short' });
}

export function GananciasConductorScreen() {
  const { data, isPending } = useDriverEarnings();

  return (
    <SafeAreaView style={styles.root}>
      <FlatList
        data={data?.recent ?? []}
        keyExtractor={(item) => item.rideId}
        contentContainerStyle={styles.content}
        ListHeaderComponent={
          <View style={styles.headerBlock}>
            <Text style={styles.header}>Ganancias</Text>

            <View style={styles.total}>
              <Text style={styles.totalLabel}>Total de hoy</Text>
              <Text style={styles.totalValue}>Bs {formatBolivianos(data?.totalToday ?? 0)}</Text>
            </View>

            <View style={styles.cards}>
              <Card icon="car-outline" label="Viajes hoy" value={String(data?.tripsToday ?? 0)} />
              <Card
                icon="wallet-outline"
                label="Histórico"
                value={`Bs ${formatBolivianos(data?.totalAllTime ?? 0)}`}
              />
            </View>

            <Text style={styles.sectionTitle}>Viajes recientes</Text>
          </View>
        }
        renderItem={({ item }) => <EarningsRow item={item} />}
        ListEmptyComponent={
          isPending ? (
            <ActivityIndicator color={colors.primary} style={styles.loader} />
          ) : (
            <View style={styles.empty}>
              <Ionicons name="bar-chart-outline" size={40} color={colors.textSecondary} />
              <Text style={styles.emptyText}>Aún no hay viajes completados.</Text>
            </View>
          )
        }
      />
    </SafeAreaView>
  );
}

function Card({
  icon,
  label,
  value,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  value: string;
}) {
  return (
    <View style={styles.card}>
      <Ionicons name={icon} size={22} color={colors.primary} />
      <Text style={styles.cardValue}>{value}</Text>
      <Text style={styles.cardLabel}>{label}</Text>
    </View>
  );
}

function EarningsRow({ item }: { item: EarningsItem }) {
  return (
    <View style={styles.row}>
      <View style={styles.rowIcon}>
        <Ionicons name="car" size={18} color={colors.primary} />
      </View>
      <View style={styles.rowInfo}>
        <Text style={styles.rowDest} numberOfLines={1}>
          {item.destinationName}
        </Text>
        <Text style={styles.rowDate}>{formatDate(item.completedAt)}</Text>
      </View>
      <Text style={styles.rowPrice}>Bs {formatBolivianos(item.price)}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.lg, gap: spacing.sm },
  headerBlock: { gap: spacing.md, marginBottom: spacing.sm },
  header: { fontSize: fontSize.xl, fontWeight: fontWeight.bold, color: colors.text, marginTop: spacing.sm },

  total: { padding: spacing.lg, borderRadius: radius.lg, backgroundColor: colors.primary, gap: spacing.xs },
  totalLabel: { fontSize: fontSize.sm, color: colors.textOnPrimary, opacity: 0.85 },
  totalValue: { fontSize: fontSize.xxl, fontWeight: fontWeight.bold, color: colors.textOnPrimary },

  cards: { flexDirection: 'row', gap: spacing.md },
  card: {
    flex: 1,
    alignItems: 'center',
    gap: spacing.xs,
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceMuted,
  },
  cardValue: { fontSize: fontSize.lg, fontWeight: fontWeight.bold, color: colors.text },
  cardLabel: { fontSize: fontSize.xs, color: colors.textSecondary },

  sectionTitle: { fontSize: fontSize.md, fontWeight: fontWeight.semibold, color: colors.text },

  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  rowIcon: {
    width: 36,
    height: 36,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceMuted,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowInfo: { flex: 1, gap: 2 },
  rowDest: { fontSize: fontSize.md, fontWeight: fontWeight.medium, color: colors.text },
  rowDate: { fontSize: fontSize.xs, color: colors.textSecondary },
  rowPrice: { fontSize: fontSize.md, fontWeight: fontWeight.bold, color: colors.primary },

  loader: { marginTop: spacing.xl },
  empty: { alignItems: 'center', gap: spacing.sm, padding: spacing.xl },
  emptyText: { fontSize: fontSize.md, color: colors.textSecondary, textAlign: 'center' },
});
