/**
 * Historial de viajes (pasajero o conductor) — diseño Stitch "Historial de Viajes".
 *
 * Tabs Completados / Cancelados; cada tarjeta muestra el destino, la fecha, la
 * contraparte (vehículo) y el precio. El backend infiere el rol desde el token,
 * así que la misma pantalla sirve para ambos roles.
 */
import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { colors, fontSize, fontWeight, radius, spacing } from '@/core/theme';
import { useRideHistory } from '@/features/rides/application/useCloseFlow';
import { formatBolivianos } from '@/features/rides/domain/money';
import type { RideHistoryItem, RideStatus } from '@/features/rides/domain/types';

const SERVICE_LABELS = { taxi: 'Taxi', moto: 'Moto' } as const;

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
  const { data, isPending } = useRideHistory(tab);

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
            >
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
        ListEmptyComponent={
          isPending ? (
            <ActivityIndicator color={colors.primary} style={styles.loader} />
          ) : (
            <View style={styles.empty}>
              <Ionicons name="time-outline" size={40} color={colors.textSecondary} />
              <Text style={styles.emptyText}>
                No tienes viajes {tab === 'completed' ? 'completados' : 'cancelados'}.
              </Text>
            </View>
          )
        }
      />
    </SafeAreaView>
  );
}

function HistoryCard({ item }: { item: RideHistoryItem }) {
  const cp = item.counterpart;
  const vehicle = cp
    ? [cp.vehicleType ? SERVICE_LABELS[cp.vehicleType] : null, cp.vehicleModel]
        .filter(Boolean)
        .join(' · ')
    : SERVICE_LABELS[item.service];

  return (
    <View style={styles.card}>
      <View style={styles.cardIcon}>
        <Ionicons name="car" size={20} color={colors.primary} />
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

  list: { padding: spacing.lg, paddingTop: 0, gap: spacing.sm },
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

  loader: { marginTop: spacing.xl },
  empty: { alignItems: 'center', gap: spacing.sm, padding: spacing.xl },
  emptyText: { fontSize: fontSize.md, color: colors.textSecondary, textAlign: 'center' },
});
