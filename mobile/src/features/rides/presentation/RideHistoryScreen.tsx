/**
 * Historial de viajes (pasajero o conductor) — diseño Stitch "Historial de Viajes".
 *
 * Tabs Completados / Cancelados; cada tarjeta muestra la ruta, la fecha, la
 * contraparte y el importe. El backend infiere el rol desde el token,
 * así que la misma pantalla sirve para ambos roles.
 */
import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { getApiErrorMessage } from '@/core/errors/apiError';
import { colors, fontSize, fontWeight, radius, spacing } from '@/core/theme';
import { SERVICE_META } from '@/features/booking/domain/serviceCatalog';
import { useRideHistory } from '@/features/rides/application/useCloseFlow';
import { formatBolivianos } from '@/features/rides/domain/money';
import type { RideHistoryItem, RideStatus } from '@/features/rides/domain/types';
import { Button, FeedbackState } from '@/shared/components';

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
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function RideHistoryScreen() {
  const [tab, setTab] = useState<'completed' | 'cancelled'>('completed');
  const {
    data,
    isPending,
    isError,
    error,
    isRefetching,
    refetch,
    hasNextPage,
    fetchNextPage,
    isFetchingNextPage,
    isFetchNextPageError,
    isRefetchError,
  } = useRideHistory(tab);
  const retry = () => void refetch();
  const loadMore = () => {
    if (hasNextPage && !isFetchingNextPage && !isFetchNextPageError) {
      void fetchNextPage();
    }
  };

  return (
    <SafeAreaView style={styles.root} edges={['top']}>
      <Text style={styles.header}>Historial</Text>
      <Text style={styles.subtitle}>Consulta tus rutas y los detalles de cada viaje.</Text>

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
        onEndReached={loadMore}
        onEndReachedThreshold={0.35}
        ListHeaderComponent={
          isRefetchError && data.length > 0 ? (
            <FeedbackState
              compact
              icon="cloud-offline-outline"
              title="No pudimos actualizar los viajes"
              message="Sigues viendo el historial cargado anteriormente."
              actionLabel="Reintentar"
              onAction={retry}
            />
          ) : null
        }
        ListFooterComponent={
          isFetchingNextPage ? (
            <ActivityIndicator
              accessibilityLabel="Cargando más viajes"
              style={styles.pageLoader}
              color={colors.primary}
            />
          ) : isFetchNextPageError ? (
            <View style={styles.pageError}>
              <Text style={styles.cardMeta}>No pudimos cargar más viajes.</Text>
              <Button
                title="Reintentar cargar más"
                variant="secondary"
                onPress={() => void fetchNextPage()}
              />
            </View>
          ) : null
        }
        refreshControl={
          <RefreshControl
            refreshing={!isPending && isRefetching && !isFetchingNextPage}
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
              message={tab === 'completed'
                ? 'Al terminar un viaje, podrás consultar aquí su ruta e importe.'
                : 'Si cancelas un viaje, sus detalles aparecerán aquí.'}
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
      <View style={styles.cardHeader}>
        <View style={styles.cardIcon}>
          <Ionicons name={SERVICE_META[item.service].icon} size={20} color={colors.primary} />
        </View>
        <View style={styles.cardInfo}>
          <Text style={styles.serviceLabel}>{SERVICE_META[item.service].label}</Text>
          <Text style={styles.cardMeta}>{formatDate(item.createdAt)}</Text>
        </View>
      </View>
      <View style={styles.routeRow}>
        <Ionicons name="ellipse-outline" size={16} color={colors.textSecondary} />
        <View style={styles.cardInfo}>
          <Text style={styles.cardMeta}>Origen</Text>
          <Text style={styles.routeText}>{item.origin.name}</Text>
        </View>
      </View>
      <View style={styles.routeRow}>
        <Ionicons name="location" size={16} color={colors.primary} />
        <View style={styles.cardInfo}>
          <Text style={styles.cardMeta}>Destino</Text>
          <Text style={styles.cardDest}>{item.destination.name}</Text>
        </View>
      </View>
      {cp ? (
        <View style={styles.participant}>
          <Ionicons name="person-outline" size={16} color={colors.textSecondary} />
          <Text style={styles.participantText}>
            {[cp.fullName, vehicle, cp.plate].filter(Boolean).join(' · ')}
          </Text>
        </View>
      ) : null}
      <View style={styles.cardFooter}>
        <View style={styles.cardInfo}>
          <Text style={styles.cardMeta}>
            {item.status === 'cancelled' ? 'Importe de referencia' : 'Importe del viaje'}
          </Text>
          <Text style={styles.cardPrice}>Bs {formatBolivianos(item.price)}</Text>
          <Text style={styles.cardMeta}>{item.payment === 'cash' ? 'Efectivo' : 'QR'}</Text>
        </View>
        {item.myRating != null && (
          <View
            style={styles.rating}
            accessible
            accessibilityLabel={`Tu calificación: ${item.myRating} de 5 estrellas`}>
            <Ionicons name="star" size={16} color={colors.primary} />
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
  subtitle: {
    paddingHorizontal: spacing.lg,
    marginTop: spacing.xs,
    fontSize: fontSize.sm,
    color: colors.textSecondary,
  },
  tabs: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    padding: spacing.lg,
    paddingBottom: spacing.sm,
  },
  tab: {
    flex: 1,
    flexBasis: 160,
    minWidth: 160,
    minHeight: 48,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceMuted,
  },
  tabActive: { backgroundColor: colors.primary },
  tabText: {
    maxWidth: '100%',
    textAlign: 'center',
    fontSize: fontSize.sm,
    fontWeight: fontWeight.semibold,
    color: colors.textSecondary,
  },
  tabTextActive: { color: colors.textOnPrimary },

  list: { flexGrow: 1, padding: spacing.lg, paddingTop: 0, gap: spacing.sm },
  card: {
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  serviceLabel: { fontSize: fontSize.sm, fontWeight: fontWeight.semibold, color: colors.primary },
  routeRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  routeText: { fontSize: fontSize.sm, color: colors.text },
  participant: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  participantText: { flex: 1, fontSize: fontSize.xs, color: colors.textSecondary },
  cardFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: spacing.sm,
  },
  cardIcon: {
    width: 40,
    height: 40,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceMuted,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardInfo: { flex: 1, minWidth: 0, gap: spacing.xs },
  cardDest: { fontSize: fontSize.md, fontWeight: fontWeight.semibold, color: colors.text },
  cardMeta: { fontSize: fontSize.xs, color: colors.textSecondary },
  cardPrice: { fontSize: fontSize.md, fontWeight: fontWeight.bold, color: colors.text },
  rating: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.xs,
    backgroundColor: colors.surfaceMuted, borderRadius: radius.pill, padding: spacing.sm,
  },
  ratingText: { fontSize: fontSize.sm, color: colors.primary, fontWeight: fontWeight.semibold },
  pageLoader: { marginVertical: spacing.md },
  pageError: { gap: spacing.sm, paddingVertical: spacing.md },

});
