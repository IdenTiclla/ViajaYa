/**
 * Historial de viajes (pasajero o conductor) — diseño Stitch "Historial de Viajes".
 *
 * Tabs Completados / Cancelados; cada tarjeta muestra el destino, la fecha, la
 * contraparte (vehículo) y el precio. El backend infiere el rol desde el token,
 * así que la misma pantalla sirve para ambos roles.
 */
import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { getApiErrorMessage } from '@/core/errors/apiError';
import { colors, fontSize, fontWeight, radius, spacing } from '@/core/theme';
import { SERVICE_META } from '@/features/booking/domain/serviceCatalog';
import { useRideHistory } from '@/features/rides/application/useCloseFlow';
import { formatBolivianos } from '@/features/rides/domain/money';
import type { RideHistoryItem, RideStatus } from '@/features/rides/domain/types';
import { FeedbackState } from '@/shared/components';

const VEHICLE_LABELS = { taxi: 'Taxi', moto: 'Moto' } as const;

const TABS: { key: Extract<RideStatus, 'completed' | 'cancelled'>; label: string }[] = [
  { key: 'completed', label: 'Completados' },
  { key: 'cancelled', label: 'Cancelados' },
];

function formatDate(iso: string | null): string {
  if (!iso) return '';
  return new Date(iso).toLocaleString('es-BO', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function RideHistoryScreen() {
  const [tab, setTab] = useState<'completed' | 'cancelled'>('completed');
  const { data, isPending, isError, error, isRefetching, refetch } = useRideHistory(tab);
  const retry = () => void refetch();

  return (
    <SafeAreaView style={styles.root} edges={['top']}>
      <Text style={styles.header}>Historial</Text>

      <View style={styles.tabs}>
        {TABS.map((t) => {
          const active = tab === t.key;
          return (
            <Pressable
              key={t.key}
              style={[styles.tab, active && styles.tabActive]}
              onPress={() => setTab(t.key)}
              accessibilityRole="tab"
              accessibilityState={{ selected: active }}
              accessibilityLabel={`Viajes ${t.label.toLowerCase()}`}>
              <Text style={[styles.tabText, active && styles.tabTextActive]}>{t.label}</Text>
            </Pressable>
          );
        })}
      </View>

      <FlatList
        data={data ?? []}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        renderItem={({ item }) => <HistoryCard item={item} />}
        refreshControl={
          <RefreshControl
            refreshing={!isPending && isRefetching}
            onRefresh={retry}
            tintColor={colors.primary}
            colors={[colors.primary]}
          />
        }
        ListEmptyComponent={
          isPending ? (
            <FeedbackState compact loading title="Cargando viajes…" />
          ) : isError ? (
            <FeedbackState
              compact
              icon="cloud-offline-outline"
              title="No pudimos cargar tu historial"
              message={getApiErrorMessage(error)}
              actionLabel="Reintentar"
              onAction={retry}
            />
          ) : (
            <FeedbackState
              compact
              icon="time-outline"
              title={`No tienes viajes ${tab === 'completed' ? 'completados' : 'cancelados'}`}
              message="Cuando tengas movimientos aparecerán aquí."
            />
          )
        }
      />
    </SafeAreaView>
  );
}

function HistoryCard({ item }: { item: RideHistoryItem }) {
  const cp = item.counterpart;
  const vehicle = cp
    ? [cp.vehicleType ? VEHICLE_LABELS[cp.vehicleType] : null, cp.vehicleModel]
        .filter(Boolean)
        .join(' · ')
    : SERVICE_META[item.service].shortLabel;

  return (
    <View style={styles.card}>
      <View style={styles.cardIcon}>
        <Ionicons name={SERVICE_META[item.service].icon} size={20} color={colors.primary} />
      </View>
      <View style={styles.cardInfo}>
        <Text style={styles.cardDest} numberOfLines={1}>
          {item.destination.name}
        </Text>
        <Text style={styles.cardMeta} numberOfLines={1}>
          {formatDate(item.createdAt)}
          {vehicle ? ` · ${vehicle}` : ''}
        </Text>
      </View>
      <View style={styles.cardRight}>
        <Text style={styles.cardPrice}>Bs {formatBolivianos(item.price)}</Text>
        {item.myRating != null && (
          <View style={styles.rating}>
            <Ionicons name="star" size={12} color={colors.accent} />
            <Text style={styles.ratingText}>{item.myRating.toFixed(1)}</Text>
          </View>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  header: {
    fontSize: fontSize.xl,
    fontWeight: fontWeight.bold,
    color: colors.text,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
  },
  tabs: { flexDirection: 'row', gap: spacing.sm, padding: spacing.lg, paddingBottom: spacing.sm },
  tab: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceMuted,
  },
  tabActive: { backgroundColor: colors.primary },
  tabText: { fontSize: fontSize.sm, fontWeight: fontWeight.semibold, color: colors.textSecondary },
  tabTextActive: { color: colors.textOnPrimary },

  list: { flexGrow: 1, padding: spacing.lg, paddingTop: 0, gap: spacing.sm },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  cardIcon: {
    width: 40,
    height: 40,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceMuted,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardInfo: { flex: 1, gap: 2 },
  cardDest: { fontSize: fontSize.md, fontWeight: fontWeight.semibold, color: colors.text },
  cardMeta: { fontSize: fontSize.xs, color: colors.textSecondary },
  cardRight: { alignItems: 'flex-end', gap: 2 },
  cardPrice: { fontSize: fontSize.md, fontWeight: fontWeight.bold, color: colors.text },
  rating: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  ratingText: { fontSize: fontSize.xs, color: colors.textSecondary },

});
