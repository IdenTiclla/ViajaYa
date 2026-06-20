/**
 * Ofertas en Mapa (conductor) — diseño Stitch "Ofertas en Mapa".
 *
 * Mapa con un marcador (precio) por solicitud abierta y un carrusel inferior de
 * tarjetas. La solicitud seleccionada (la del centro del carrusel o el marcador
 * tocado) dibuja su **trayecto** (origen→destino por calles). Tocar una tarjeta
 * abre el detalle; también permite aceptar/contraofertar/rechazar directamente.
 */
import { Ionicons } from '@expo/vector-icons';
import { useEffect, useRef, useState } from 'react';
import { Dimensions, FlatList, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import MapView, { Marker, Polyline, PROVIDER_GOOGLE, type Region } from 'react-native-maps';

import { colors, fontSize, fontWeight, radius, spacing } from '@/core/theme';
import { useRoute } from '@/features/booking/application/useRoute';
import { declutteredMapStyle } from '@/features/booking/presentation/mapStyle';
import type { Coordinates } from '@/features/booking/domain/types';
import { formatKm, haversineKm, pricePerKm } from '@/features/rides/domain/geo';
import type { OpenRide } from '@/features/rides/domain/types';

const { width } = Dimensions.get('window');
const CARD_WIDTH = width - spacing.lg * 2;
const SNAP = CARD_WIDTH + spacing.md;

type Props = {
  rides: OpenRide[];
  disabled: boolean;
  onOpenDetail: (ride: OpenRide) => void;
  onAccept: (ride: OpenRide) => void;
  onCounter: (ride: OpenRide) => void;
  onDismiss: (ride: OpenRide) => void;
  isOffered: (rideId: string) => boolean;
};

export function SolicitudesMapa({
  rides,
  disabled,
  onOpenDetail,
  onAccept,
  onCounter,
  onDismiss,
  isOffered,
}: Props) {
  const mapRef = useRef<MapView>(null);
  const listRef = useRef<FlatList<OpenRide>>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const selectedRide = rides.find((r) => r.id === selectedId) ?? rides[0] ?? null;
  const { route } = useRoute(
    selectedRide?.origin ?? null,
    selectedRide?.destination ?? null,
  );

  const polyline: Coordinates[] = route?.coordinates.length
    ? route.coordinates
    : selectedRide
      ? [selectedRide.origin.coordinates, selectedRide.destination.coordinates]
      : [];

  // Encuadra el trayecto de la solicitud seleccionada cuando cambia.
  useEffect(() => {
    if (!selectedRide) return;
    const coords =
      polyline.length >= 2
        ? polyline
        : [selectedRide.origin.coordinates, selectedRide.destination.coordinates];
    mapRef.current?.fitToCoordinates(coords, {
      edgePadding: { top: 80, right: 60, bottom: 300, left: 60 },
      animated: true,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, polyline.length]);

  const select = (ride: OpenRide, index?: number) => {
    setSelectedId(ride.id);
    if (index != null) listRef.current?.scrollToIndex({ index, animated: true });
  };

  const initialRegion: Region | undefined = rides[0]
    ? {
        latitude: rides[0].origin.coordinates.latitude,
        longitude: rides[0].origin.coordinates.longitude,
        latitudeDelta: 0.05,
        longitudeDelta: 0.05,
      }
    : undefined;

  if (!initialRegion) {
    return (
      <View style={styles.empty}>
        <Ionicons name="map-outline" size={48} color={colors.textSecondary} />
        <Text style={styles.emptyText}>No hay solicitudes en el mapa por ahora.</Text>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <MapView
        ref={mapRef}
        provider={PROVIDER_GOOGLE}
        style={StyleSheet.absoluteFill}
        initialRegion={initialRegion}
        customMapStyle={declutteredMapStyle}>
        {/* Trayecto de la solicitud seleccionada */}
        {polyline.length >= 2 && (
          <>
            <Polyline coordinates={polyline} strokeColor={colors.surface} strokeWidth={9} />
            <Polyline coordinates={polyline} strokeColor={colors.primary} strokeWidth={5} />
          </>
        )}
        {selectedRide && (
          <Marker
            coordinate={selectedRide.destination.coordinates}
            title={selectedRide.destination.name}
            pinColor={colors.danger}
            anchor={{ x: 0.5, y: 1 }}
          />
        )}
        {/* Marcador (precio) por cada origen */}
        {rides.map((ride) => {
          const active = ride.id === selectedRide?.id;
          return (
            <Marker
              key={ride.id}
              coordinate={ride.origin.coordinates}
              onPress={() => select(ride, rides.indexOf(ride))}
              anchor={{ x: 0.5, y: 1 }}>
              <View style={[styles.priceMarker, active && styles.priceMarkerActive]}>
                <Text style={[styles.priceMarkerText, active && styles.priceMarkerTextActive]}>
                  Bs {ride.fare.toFixed(0)}
                </Text>
              </View>
            </Marker>
          );
        })}
      </MapView>

      <FlatList
        ref={listRef}
        data={rides}
        keyExtractor={(r) => r.id}
        horizontal
        showsHorizontalScrollIndicator={false}
        snapToInterval={SNAP}
        decelerationRate="fast"
        contentContainerStyle={styles.carousel}
        style={styles.carouselWrap}
        getItemLayout={(_, index) => ({ length: SNAP, offset: SNAP * index, index })}
        onMomentumScrollEnd={(e) => {
          const index = Math.round(e.nativeEvent.contentOffset.x / SNAP);
          if (rides[index]) setSelectedId(rides[index].id);
        }}
        renderItem={({ item }) => (
          <MapCard
            ride={item}
            offered={isOffered(item.id)}
            disabled={disabled}
            onPress={() => onOpenDetail(item)}
            onAccept={() => onAccept(item)}
            onCounter={() => onCounter(item)}
            onDismiss={() => onDismiss(item)}
          />
        )}
      />
    </View>
  );
}

function MapCard({
  ride,
  offered,
  disabled,
  onPress,
  onAccept,
  onCounter,
  onDismiss,
}: {
  ride: OpenRide;
  offered: boolean;
  disabled: boolean;
  onPress: () => void;
  onAccept: () => void;
  onCounter: () => void;
  onDismiss: () => void;
}) {
  const tripKm = haversineKm(ride.origin.coordinates, ride.destination.coordinates);
  const perKm = pricePerKm(ride.fare, tripKm);
  return (
    <TouchableOpacity activeOpacity={0.95} onPress={onPress} style={styles.card}>
      <View style={styles.cardHeader}>
        <View style={styles.serviceTag}>
          <Ionicons
            name={ride.service === 'taxi' ? 'car-sport' : 'bicycle'}
            size={16}
            color={colors.primary}
          />
          <Text style={styles.serviceText}>{ride.service === 'taxi' ? 'Taxi' : 'Moto'}</Text>
          <Text style={styles.distance}>· {formatKm(tripKm)}</Text>
        </View>
        <View style={styles.fareBox}>
          <Text style={styles.fare}>Bs {ride.fare.toFixed(2)}</Text>
          {perKm && <Text style={styles.perKm}>Bs {perKm}/km</Text>}
        </View>
      </View>
      <View style={styles.routeRow}>
        <Ionicons name="navigate-circle" size={16} color={colors.primary} />
        <Text style={styles.routeText} numberOfLines={1}>
          {ride.origin.name}
        </Text>
      </View>
      <View style={styles.routeRow}>
        <Ionicons name="location" size={16} color={colors.danger} />
        <Text style={styles.routeText} numberOfLines={1}>
          {ride.destination.name}
        </Text>
      </View>

      {offered ? (
        <View style={styles.offeredBox}>
          <Ionicons name="checkmark-circle" size={16} color={colors.success} />
          <Text style={styles.offeredText}>Oferta enviada</Text>
        </View>
      ) : (
        <View style={styles.actions}>
          <TouchableOpacity
            style={styles.iconReject}
            onPress={onDismiss}
            disabled={disabled}
            accessibilityRole="button"
            accessibilityLabel="Rechazar">
            <Ionicons name="close" size={20} color={colors.danger} />
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.actionBtn, styles.counter, disabled && styles.disabled]}
            onPress={onCounter}
            disabled={disabled}
            accessibilityRole="button"
            accessibilityLabel="Contraofertar">
            <Text style={styles.counterText}>Contraofertar</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.actionBtn, styles.accept, disabled && styles.disabled]}
            onPress={onAccept}
            disabled={disabled}
            accessibilityRole="button"
            accessibilityLabel={`Aceptar por Bs ${ride.fare.toFixed(2)}`}>
            <Text style={styles.acceptText}>Aceptar</Text>
          </TouchableOpacity>
        </View>
      )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.sm, padding: spacing.xl },
  emptyText: { fontSize: fontSize.md, color: colors.textSecondary, textAlign: 'center' },

  priceMarker: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    borderWidth: 2,
    borderColor: colors.primary,
  },
  priceMarkerActive: { backgroundColor: colors.primary },
  priceMarkerText: { color: colors.primary, fontSize: fontSize.sm, fontWeight: fontWeight.bold },
  priceMarkerTextActive: { color: colors.textOnPrimary },

  carouselWrap: { position: 'absolute', left: 0, right: 0, bottom: spacing.lg },
  carousel: { paddingHorizontal: spacing.lg, gap: spacing.md },
  card: {
    width: CARD_WIDTH,
    padding: spacing.md,
    gap: spacing.sm,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    shadowColor: '#000',
    shadowOpacity: 0.15,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 8,
  },
  cardHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  serviceTag: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  serviceText: { fontSize: fontSize.sm, fontWeight: fontWeight.semibold, color: colors.primary },
  distance: { fontSize: fontSize.sm, color: colors.textSecondary },
  fareBox: { alignItems: 'flex-end' },
  fare: { fontSize: fontSize.lg, fontWeight: fontWeight.bold, color: colors.text },
  perKm: { fontSize: fontSize.xs, color: colors.textSecondary },
  routeRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  routeText: { flex: 1, fontSize: fontSize.sm, color: colors.text },

  actions: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.xs },
  iconReject: {
    width: 44,
    height: 44,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionBtn: { flex: 1, height: 44, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
  counter: { borderWidth: 1, borderColor: colors.primary, backgroundColor: colors.surface },
  counterText: { color: colors.primary, fontSize: fontSize.sm, fontWeight: fontWeight.semibold },
  accept: { backgroundColor: colors.primary },
  acceptText: { color: colors.textOnPrimary, fontSize: fontSize.md, fontWeight: fontWeight.bold },
  disabled: { opacity: 0.5 },

  offeredBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.xs,
    padding: spacing.sm,
    borderRadius: radius.sm,
    backgroundColor: colors.surfaceMuted,
  },
  offeredText: { fontSize: fontSize.sm, color: colors.textSecondary },
});
