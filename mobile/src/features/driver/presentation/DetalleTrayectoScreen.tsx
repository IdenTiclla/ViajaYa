/**
 * Detalle del Trayecto (conductor) — diseño Stitch "Detalle del Trayecto".
 *
 * Mapa con el trayecto (origen→destino por calles), tarjeta con la oferta del
 * pasajero, distancia/tiempo estimados y acciones Aceptar / Contraofertar /
 * Rechazar. Lee la solicitud de la caché de `/rides/open` (polling) por id.
 */
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import MapView, { Marker, Polyline, PROVIDER_GOOGLE, type Region } from 'react-native-maps';
import { SafeAreaView } from 'react-native-safe-area-context';

import { getApiErrorMessage } from '@/core/errors/apiError';
import { colors, fontSize, fontWeight, radius, spacing } from '@/core/theme';
import { useRoute } from '@/features/booking/application/useRoute';
import { declutteredMapStyle } from '@/features/booking/presentation/mapStyle';
import type { Coordinates } from '@/features/booking/domain/types';
import { useDriverRequests } from '@/features/driver/application/useDriverRequests';
import { CounterOfferModal } from '@/features/driver/presentation/CounterOfferModal';
import { RideUnavailableScreen } from '@/features/driver/presentation/RideUnavailableScreen';
import { useCreateOffer } from '@/features/rides/application/useRideMutations';
import { useOpenRides } from '@/features/rides/application/useRides';
import { formatKm, haversineKm, pricePerKm } from '@/features/rides/domain/geo';

function formatDuration(seconds: number): string {
  return `${Math.max(1, Math.round(seconds / 60))} min`;
}

export function DetalleTrayectoScreen() {
  const router = useRouter();
  const { rideId, originName, destName, fare } = useLocalSearchParams<{
    rideId?: string;
    originName?: string;
    destName?: string;
    fare?: string;
  }>();
  const mapRef = useRef<MapView>(null);

  const { rides, isLoading } = useOpenRides();
  const ride = rides.find((r) => r.id === rideId);

  const createOffer = useCreateOffer();
  const markOffered = useDriverRequests((s) => s.markOffered);
  const dismiss = useDriverRequests((s) => s.dismiss);
  const [counterOpen, setCounterOpen] = useState(false);

  const origin = ride?.origin ?? null;
  const destination = ride?.destination ?? null;
  const { route } = useRoute(origin, destination);

  const region: Region | undefined =
    origin && destination
      ? {
          latitude: (origin.coordinates.latitude + destination.coordinates.latitude) / 2,
          longitude: (origin.coordinates.longitude + destination.coordinates.longitude) / 2,
          latitudeDelta: Math.max(
            Math.abs(origin.coordinates.latitude - destination.coordinates.latitude) * 1.8,
            0.02,
          ),
          longitudeDelta: Math.max(
            Math.abs(origin.coordinates.longitude - destination.coordinates.longitude) * 1.8,
            0.02,
          ),
        }
      : undefined;

  const polyline: Coordinates[] = route?.coordinates.length
    ? route.coordinates
    : origin && destination
      ? [origin.coordinates, destination.coordinates]
      : [];

  const fitToTrip = (animated: boolean) => {
    if (polyline.length < 2) return;
    mapRef.current?.fitToCoordinates(polyline, {
      edgePadding: { top: 80, right: 50, bottom: 360, left: 50 },
      animated,
    });
  };

  // Reencuadra cuando llega/cambia el trayecto (la dependencia es la longitud
  // de la polilínea, que cambia al resolverse la ruta por calles).
  useEffect(() => {
    fitToTrip(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [polyline.length]);

  // Aún cargando la lista de solicitudes: evitamos el flash de "no disponible".
  if (!ride && isLoading) {
    return (
      <SafeAreaView style={[styles.root, styles.center]}>
        <ActivityIndicator size="large" color={colors.primary} />
      </SafeAreaView>
    );
  }

  // La solicitud ya no está abierta (otro conductor la tomó, se canceló o
  // expiró su ventana): mostramos la pantalla de "viaje ya no disponible".
  if (!ride || !region) {
    return (
      <RideUnavailableScreen
        price={fare ? Number.parseFloat(fare) : null}
        originName={originName ?? null}
        destName={destName ?? null}
        onBack={() => router.back()}
        priceLabel="Oferta del pasajero"
      />
    );
  }

  const tripKm = haversineKm(ride.origin.coordinates, ride.destination.coordinates);
  const perKm = pricePerKm(ride.fare, tripKm);

  // Tras ofertar, el conductor vuelve a la lista (la tarjeta queda "esperando");
  // puede tocarla luego para ver el estado de la oferta.
  const accept = () => {
    createOffer.mutate(
      { rideId: ride.id, input: { acceptAtFare: true } },
      {
        onSuccess: (offer) => {
          markOffered(ride.id, offer);
          router.back();
        },
      },
    );
  };

  const counter = (price: number, etaMin: number | undefined) => {
    createOffer.mutate(
      { rideId: ride.id, input: { acceptAtFare: false, price, etaMin } },
      {
        onSuccess: (offer) => {
          markOffered(ride.id, offer);
          setCounterOpen(false);
          router.back();
        },
      },
    );
  };

  const reject = () => {
    dismiss(ride.id);
    router.back();
  };

  return (
    <View style={styles.root}>
      <MapView
        ref={mapRef}
        provider={PROVIDER_GOOGLE}
        style={StyleSheet.absoluteFill}
        initialRegion={region}
        customMapStyle={declutteredMapStyle}
        onMapReady={() => fitToTrip(false)}>
        <Marker coordinate={ride.origin.coordinates} anchor={{ x: 0.5, y: 0.5 }} title={ride.origin.name}>
          <View style={styles.originDot} />
        </Marker>
        <Marker coordinate={ride.destination.coordinates} title={ride.destination.name} pinColor={colors.danger} />
        {polyline.length >= 2 && (
          <>
            <Polyline coordinates={polyline} strokeColor={colors.surface} strokeWidth={9} />
            <Polyline coordinates={polyline} strokeColor={colors.primary} strokeWidth={5} />
          </>
        )}
      </MapView>

      <SafeAreaView style={styles.topBar} edges={['top']} pointerEvents="box-none">
        <TouchableOpacity
          style={styles.iconBtn}
          onPress={() => router.back()}
          accessibilityRole="button"
          accessibilityLabel="Volver">
          <Ionicons name="arrow-back" size={24} color={colors.text} />
        </TouchableOpacity>
      </SafeAreaView>

      <SafeAreaView style={styles.sheet} edges={['bottom']}>
        <View style={styles.sheetHandle} />

        <View style={styles.fareHeader}>
          <View>
            <Text style={styles.fareLabel}>Oferta del pasajero</Text>
            <Text style={styles.fareValue}>Bs {ride.fare.toFixed(2)}</Text>
            {perKm && <Text style={styles.farePerKm}>Bs {perKm} / km</Text>}
          </View>
          <View style={styles.serviceBadge}>
            <Ionicons
              name={ride.service === 'taxi' ? 'car-sport' : 'bicycle'}
              size={18}
              color={colors.primary}
            />
            <Text style={styles.serviceBadgeText}>{ride.service === 'taxi' ? 'Taxi' : 'Moto'}</Text>
          </View>
        </View>

        <View style={styles.stats}>
          <Stat icon="navigate" label="Distancia" value={formatKm(tripKm)} />
          <Stat
            icon="time"
            label="Tiempo"
            value={route ? formatDuration(route.durationSeconds) : '—'}
          />
          <Stat icon="card" label="Pago" value={ride.payment === 'qr' ? 'QR' : 'Efectivo'} />
        </View>

        <View style={styles.routeCard}>
          <View style={styles.routeRow}>
            <Ionicons name="navigate-circle" size={20} color={colors.primary} />
            <Text style={styles.routeText} numberOfLines={1}>
              {ride.origin.name}
            </Text>
          </View>
          <View style={styles.routeRow}>
            <Ionicons name="location" size={20} color={colors.danger} />
            <Text style={styles.routeText} numberOfLines={1}>
              {ride.destination.name}
            </Text>
          </View>
        </View>

        {createOffer.isError && (
          <Text style={styles.error}>{getApiErrorMessage(createOffer.error)}</Text>
        )}

        <View style={styles.actions}>
          <TouchableOpacity
            style={[styles.actionBtn, styles.counterBtn, createOffer.isPending && styles.disabled]}
            onPress={() => setCounterOpen(true)}
            disabled={createOffer.isPending}
            accessibilityRole="button"
            accessibilityLabel="Contraofertar">
            <Text style={styles.counterText}>Contraofertar</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.actionBtn, styles.acceptBtn, createOffer.isPending && styles.disabled]}
            onPress={accept}
            disabled={createOffer.isPending}
            accessibilityRole="button"
            accessibilityLabel={`Aceptar por Bs ${ride.fare.toFixed(2)}`}>
            {createOffer.isPending ? (
              <ActivityIndicator color={colors.textOnPrimary} />
            ) : (
              <Text style={styles.acceptText}>Aceptar</Text>
            )}
          </TouchableOpacity>
        </View>
        <TouchableOpacity
          style={styles.rejectBtn}
          onPress={reject}
          disabled={createOffer.isPending}
          accessibilityRole="button"
          accessibilityLabel="Rechazar solicitud">
          <Ionicons name="close" size={16} color={colors.danger} />
          <Text style={styles.rejectText}>Rechazar</Text>
        </TouchableOpacity>
      </SafeAreaView>

      <CounterOfferModal
        visible={counterOpen}
        riderFare={ride.fare}
        submitting={createOffer.isPending}
        onCancel={() => setCounterOpen(false)}
        onSubmit={counter}
      />
    </View>
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
      <Ionicons name={icon} size={20} color={colors.primary} />
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surfaceMuted },
  center: { alignItems: 'center', justifyContent: 'center', gap: spacing.md, padding: spacing.lg },

  originDot: {
    width: 18,
    height: 18,
    borderRadius: radius.pill,
    backgroundColor: colors.primary,
    borderWidth: 3,
    borderColor: colors.surface,
  },

  topBar: { position: 'absolute', top: 0, left: 0, right: 0, paddingHorizontal: spacing.md, paddingTop: spacing.sm },
  iconBtn: {
    width: 44,
    height: 44,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.1,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 3,
  },

  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    padding: spacing.lg,
    gap: spacing.md,
    backgroundColor: colors.background,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    shadowColor: '#000',
    shadowOpacity: 0.12,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: -3 },
    elevation: 12,
  },
  sheetHandle: {
    width: 40,
    height: 4,
    borderRadius: radius.pill,
    backgroundColor: colors.border,
    alignSelf: 'center',
  },

  fareHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  fareLabel: { fontSize: fontSize.sm, color: colors.textSecondary },
  fareValue: { fontSize: fontSize.xl, fontWeight: fontWeight.bold, color: colors.text },
  farePerKm: { fontSize: fontSize.sm, color: colors.textSecondary },
  serviceBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceMuted,
  },
  serviceBadgeText: { fontSize: fontSize.sm, fontWeight: fontWeight.semibold, color: colors.primary },

  stats: { flexDirection: 'row', gap: spacing.sm },
  stat: {
    flex: 1,
    alignItems: 'center',
    gap: 2,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceMuted,
  },
  statValue: { fontSize: fontSize.md, fontWeight: fontWeight.bold, color: colors.text },
  statLabel: { fontSize: fontSize.xs, color: colors.textSecondary },

  routeCard: { gap: spacing.sm },
  routeRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  routeText: { flex: 1, fontSize: fontSize.md, color: colors.text },

  actions: { flexDirection: 'row', gap: spacing.sm },
  actionBtn: { flex: 1, height: 52, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
  counterBtn: { borderWidth: 1, borderColor: colors.primary, backgroundColor: colors.surface },
  counterText: { color: colors.primary, fontSize: fontSize.md, fontWeight: fontWeight.semibold },
  acceptBtn: { backgroundColor: colors.primary },
  acceptText: { color: colors.textOnPrimary, fontSize: fontSize.md, fontWeight: fontWeight.bold },
  disabled: { opacity: 0.5 },
  rejectBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    paddingVertical: spacing.xs,
  },
  rejectText: { color: colors.danger, fontSize: fontSize.sm, fontWeight: fontWeight.medium },
  error: { color: colors.danger, fontSize: fontSize.sm, textAlign: 'center' },
});
