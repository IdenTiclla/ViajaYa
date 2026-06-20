/**
 * Solicitudes entrantes (conductor) — diseño Stitch "Panel de Control - Ofertas".
 *
 * Si el conductor ya tiene un viaje asignado, muestra el viaje en curso. Si no,
 * lista (polling) las solicitudes abiertas de su vehículo con un toggle
 * **Lista / Mapa**. Acciones por solicitud: Aceptar, Contraofertar (modal) y
 * Rechazar (botón o deslizando hacia la derecha). Tocar una abre el detalle.
 */
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { getApiErrorMessage } from '@/core/errors/apiError';
import { colors, fontSize, fontWeight, radius, spacing } from '@/core/theme';
import { useDriverRequests } from '@/features/driver/application/useDriverRequests';
import { CounterOfferModal } from '@/features/driver/presentation/CounterOfferModal';
import { RequestCard } from '@/features/driver/presentation/RequestCard';
import { SolicitudesMapa } from '@/features/driver/presentation/SolicitudesMapa';
import { ViajeEnCursoConductorScreen } from '@/features/driver/presentation/ViajeEnCursoConductorScreen';
import { useCreateOffer } from '@/features/rides/application/useRideMutations';
import { useDriverActiveRide, useOpenRides } from '@/features/rides/application/useRides';
import type { OpenRide } from '@/features/rides/domain/types';

type ViewMode = 'list' | 'map';

export function SolicitudesEntrantesScreen() {
  const router = useRouter();
  const { ride: activeRide } = useDriverActiveRide();
  // El WebSocket del conductor vive en el layout `(driver)`: las solicitudes
  // nuevas y los avisos de aceptación llegan en vivo en cualquier pantalla.
  // Mientras haya viaje activo, no pedimos solicitudes nuevas.
  const { rides, isLoading } = useOpenRides(!activeRide);
  const createOffer = useCreateOffer();

  const dismissed = useDriverRequests((s) => s.dismissed);
  const rejected = useDriverRequests((s) => s.rejected);
  const isOffered = useDriverRequests((s) => s.isOffered);
  const dismiss = useDriverRequests((s) => s.dismiss);
  const markOffered = useDriverRequests((s) => s.markOffered);

  const [mode, setMode] = useState<ViewMode>('list');
  const [counterFor, setCounterFor] = useState<OpenRide | null>(null);

  // Oculta las solicitudes que el conductor descartó localmente.
  const visibleRides = useMemo(
    () => rides.filter((r) => !dismissed.has(r.id)),
    [rides, dismissed],
  );

  // Ofertar NO saca al conductor de la lista: la tarjeta pasa a "esperando" y él
  // sigue viendo (y ofertando a) otras solicitudes en tiempo real.
  const acceptAtFare = (ride: OpenRide) => {
    createOffer.mutate(
      { rideId: ride.id, input: { acceptAtFare: true } },
      { onSuccess: (offer) => markOffered(ride.id, offer) },
    );
  };

  const submitCounter = (price: number, etaMin: number | undefined) => {
    if (!counterFor) return;
    const ride = counterFor;
    createOffer.mutate(
      { rideId: ride.id, input: { acceptAtFare: false, price, etaMin } },
      {
        onSuccess: (offer) => {
          markOffered(ride.id, offer);
          setCounterFor(null);
        },
      },
    );
  };

  // Tocar una tarjeta: si ya oferté (o me rechazaron, o me aceptaron), muestra
  // el estado de esa oferta; si aún no oferté, abre el detalle para ofertar.
  const openDetail = (ride: OpenRide) => {
    if (isOffered(ride.id) || rejected.has(ride.id)) {
      router.push({ pathname: '/(driver)/oferta-enviada', params: { rideId: ride.id } });
      return;
    }
    router.push({
      pathname: '/(driver)/trayecto',
      params: {
        rideId: ride.id,
        originName: ride.origin.name,
        destName: ride.destination.name,
        fare: String(ride.fare),
      },
    });
  };

  if (activeRide) {
    return <ViajeEnCursoConductorScreen ride={activeRide} />;
  }

  return (
    <SafeAreaView style={styles.root}>
      <View style={styles.topRow}>
        <Text style={styles.header}>Solicitudes ({visibleRides.length})</Text>
        <View style={styles.toggle}>
          <ToggleButton
            icon="list"
            label="Lista"
            active={mode === 'list'}
            onPress={() => setMode('list')}
          />
          <ToggleButton
            icon="map"
            label="Mapa"
            active={mode === 'map'}
            onPress={() => setMode('map')}
          />
        </View>
      </View>

      {createOffer.isError && (
        <Text style={styles.error}>{getApiErrorMessage(createOffer.error)}</Text>
      )}

      {mode === 'map' ? (
        <SolicitudesMapa
          rides={visibleRides}
          disabled={createOffer.isPending}
          onOpenDetail={openDetail}
          onAccept={acceptAtFare}
          onCounter={setCounterFor}
          onDismiss={(r) => dismiss(r.id)}
          isOffered={isOffered}
        />
      ) : (
        <FlatList
          data={visibleRides}
          keyExtractor={(r) => r.id}
          contentContainerStyle={styles.list}
          renderItem={({ item }) => (
            <RequestCard
              ride={item}
              offered={isOffered(item.id)}
              rejected={rejected.has(item.id)}
              disabled={createOffer.isPending}
              onPress={() => openDetail(item)}
              onAccept={() => acceptAtFare(item)}
              onCounter={() => setCounterFor(item)}
              onDismiss={() => dismiss(item.id)}
            />
          )}
          ListEmptyComponent={
            <View style={styles.center}>
              {isLoading ? (
                <ActivityIndicator size="large" color={colors.primary} />
              ) : (
                <>
                  <Ionicons name="cube-outline" size={48} color={colors.textSecondary} />
                  <Text style={styles.emptyText}>No hay solicitudes por ahora.</Text>
                </>
              )}
            </View>
          }
        />
      )}

      <CounterOfferModal
        visible={!!counterFor}
        riderFare={counterFor?.fare ?? 0}
        submitting={createOffer.isPending}
        onCancel={() => setCounterFor(null)}
        onSubmit={submitCounter}
      />
    </SafeAreaView>
  );
}

function ToggleButton({
  icon,
  label,
  active,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity
      style={[styles.toggleBtn, active && styles.toggleBtnActive]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      accessibilityLabel={`Ver en ${label.toLowerCase()}`}>
      <Ionicons name={icon} size={16} color={active ? colors.textOnPrimary : colors.textSecondary} />
      <Text style={[styles.toggleText, active && styles.toggleTextActive]}>{label}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
  },
  header: { fontSize: fontSize.lg, fontWeight: fontWeight.bold, color: colors.text },

  toggle: {
    flexDirection: 'row',
    padding: 3,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceMuted,
    gap: 2,
  },
  toggleBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radius.pill,
  },
  toggleBtnActive: { backgroundColor: colors.primary },
  toggleText: { fontSize: fontSize.sm, fontWeight: fontWeight.medium, color: colors.textSecondary },
  toggleTextActive: { color: colors.textOnPrimary },

  list: { padding: spacing.lg, gap: spacing.md, flexGrow: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.sm, padding: spacing.xl },
  emptyText: { fontSize: fontSize.md, color: colors.textSecondary, textAlign: 'center' },
  error: {
    color: colors.danger,
    fontSize: fontSize.sm,
    textAlign: 'center',
    marginTop: spacing.sm,
    marginHorizontal: spacing.lg,
  },
});
