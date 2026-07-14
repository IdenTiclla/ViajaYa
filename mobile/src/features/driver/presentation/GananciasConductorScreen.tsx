/**
 * Ganancias del conductor — datos reales desde `GET /drivers/me/earnings`.
 *
 * Muestra el total de hoy, contadores y el desglose de viajes completados
 * recientes con su importe.
 */
import { Ionicons } from '@expo/vector-icons';
import { FlatList, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { getApiErrorMessage } from '@/core/errors/apiError';
import { colors, fontSize, fontWeight, radius, spacing } from '@/core/theme';
import { useDriverEarnings } from '@/features/rides/application/useCloseFlow';
import { formatBolivianos } from '@/features/rides/domain/money';
import type { EarningsItem } from '@/features/rides/domain/types';
import { FeedbackState } from '@/shared/components';

function formatDate(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleDateString('es-BO', { day: '2-digit', month: 'short' });
}

export function GananciasConductorScreen() {
  const { data, isPending, isError, error, isRefetching, refetch } = useDriverEarnings();
  const retry = () => void refetch();

  return (
    <SafeAreaView style={styles.root}>
      <Text style={styles.header}>Ganancias</Text>
      {isPending ? (
        <FeedbackState loading title="Cargando ganancias…" />
      ) : isError && !data ? (
        <FeedbackState
          icon="cloud-offline-outline"
          title="No pudimos cargar tus ganancias"
          message={getApiErrorMessage(error)}
          actionLabel="Reintentar"
          onAction={retry}
        />
      ) : (
        <FlatList
          data={data?.recent ?? []}
          keyExtractor={(item) => item.rideId}
          contentContainerStyle={styles.content}
          refreshControl={
            <RefreshControl
              refreshing={isRefetching}
              onRefresh={retry}
              tintColor={colors.primary}
              colors={[colors.primary]}
            />
          }
          ListHeaderComponent={
            <View style={styles.headerBlock}>
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
            <FeedbackState
              compact
              icon="bar-chart-outline"
              title="Aún no hay viajes completados"
              message="Tus próximos viajes aparecerán en este resumen."
            />
          }
        />
      )}
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
  content: { flexGrow: 1, padding: spacing.lg, paddingTop: spacing.md, gap: spacing.sm },
  headerBlock: { gap: spacing.md, marginBottom: spacing.sm },
  header: {
    fontSize: fontSize.xl,
    fontWeight: fontWeight.bold,
    color: colors.text,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
  },

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

});
