/**
 * Solicitudes en mapa (conductor) — diseño Material-You.
 *
 * Mapa con los pines **A** (origen) por solicitud y **B** (destino) de la
 * seleccionada, unidos por el trayecto; el mapa encuadra la ruta seleccionada.
 * Abajo, una **tarjeta flotante** con la solicitud activa (avatar, precio,
 * contraoferta rápida +Bs, ruta y Rechazar/Enviar oferta) y un paginador visible
 * para navegar entre solicitudes. Tocar la tarjeta abre el detalle.
 */
import { Ionicons } from '@react-native-vector-icons/ionicons';
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  StyleSheet,
  Text,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from 'react-native';
import MapView, { PROVIDER_GOOGLE, type Region } from 'react-native-maps';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useCountdown } from '@/core/hooks/useCountdown';
import { fontSize, fontWeight, radius, spacing, useEstilos, type Tema } from '@/core/theme';
import { useRoute } from '@/features/booking/application/useRoute';
import { SERVICE_META } from '@/features/booking/domain/serviceCatalog';
import { useEstiloMapa } from '@/features/booking/presentation/mapStyle';
import { getPlaceStreetName } from '@/features/booking/domain/placeLabels';
import type { Coordinates } from '@/features/booking/domain/types';
import type { SentOffer } from '@/features/driver/application/useDriverRequests';
import { formatKm, haversineKm, pricePerKm } from '@/features/rides/domain/geo';
import { formatBolivianos } from '@/features/rides/domain/money';
import { OfferLifeTimer } from '@/features/rides/presentation/OfferLifeTimer';
import { RoutePinMarker } from '@/features/rides/presentation/RoutePinMarker';
import { MARGEN_TOOLTIP_RUTA } from '@/features/rides/presentation/routeTooltipLayout';
import { useRumboMapa } from '@/features/rides/application/useRumboMapa';
import { RoutePolyline } from '@/features/rides/presentation/RoutePolyline';
import type { OpenRide } from '@/features/rides/domain/types';
import Animated, { SlideInDown } from 'react-native-reanimated';

const PAYMENT_LABELS = { qr: 'QR', cash: 'Efectivo' } as const;
const QUICK_DELTAS = [1, 2, 5] as const;

type Props = {
  rides: OpenRide[];
  disabled: boolean;
  isOffered: (rideId: string) => boolean;
  pendingRideId: string | null;
  /** Ofertas enviadas del conductor (para el contador de expiración de la card). */
  offeredMap: Record<string, SentOffer>;
  rejected: Set<string>;
  expired: Set<string>;
  paused: Set<string>;
  taken: Set<string>;
  /** Ride a seleccionar al abrir el mapa (al tocar una tarjeta desde la lista). */
  initialSelectedId?: string | null;
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  onEndReached: () => void;
  onOpenDetail: (ride: OpenRide) => void;
  onAccept: (ride: OpenRide) => void;
  onDismiss: (ride: OpenRide) => void;
  onQuickAdd: (ride: OpenRide, delta: number) => void;
  onOpenPriceInput: (ride: OpenRide) => void;
  onWithdraw: (ride: OpenRide) => void;
};

export function SolicitudesMapa({
  rides,
  disabled,
  isOffered,
  pendingRideId,
  offeredMap,
  rejected,
  expired,
  paused,
  taken,
  initialSelectedId,
  hasNextPage,
  isFetchingNextPage,
  onEndReached,
  onOpenDetail,
  onAccept,
  onDismiss,
  onQuickAdd,
  onOpenPriceInput,
  onWithdraw,
}: Props) {
  const { colors, styles } = useEstilos(crearEstilos);
  const mapRef = useRef<MapView>(null);
  const { estiloMapa, modoMapa } = useEstiloMapa(true);
  const { rumboMapa, zoomMapa, actualizarRumbo } = useRumboMapa(mapRef);
  const listRef = useRef<FlatList<OpenRide>>(null);
  const { width: windowWidth } = useWindowDimensions();
  const cardWidth = windowWidth - spacing.sm * 2;
  const [selectedId, setSelectedId] = useState<string | null>(initialSelectedId ?? null);
  const [bottomOverlayHeight, setBottomOverlayHeight] = useState(360);

  const selectedRide = rides.find((r) => r.id === selectedId) ?? rides[0] ?? null;
  const selectedIndex = rides.findIndex((r) => r.id === selectedRide?.id);

  // Cambia la solicitud activa y sincroniza el carrusel (al tocar marker o flecha).
  const select = (ride: OpenRide, index?: number) => {
    setSelectedId(ride.id);
    if (index != null) listRef.current?.scrollToIndex({ index, animated: true });
  };
  const selectIndex = (index: number) => {
    const ride = rides[index];
    if (ride) select(ride, index);
  };
  const { route } = useRoute(selectedRide?.origin ?? null, selectedRide?.destination ?? null);

  const polyline: Coordinates[] = route?.coordinates.length
    ? route.coordinates
    : selectedRide
      ? [selectedRide.origin.coordinates, selectedRide.destination.coordinates]
      : [];

  // Encuadra el trayecto seleccionado (al montar, el useEffect corre antes de que
  // el mapa esté listo; por eso repetimos sin animación en onMapReady).
  const fitSelected = (animated = true) => {
    if (!selectedRide) return;
    const coords =
      polyline.length >= 2
        ? polyline
        : [selectedRide.origin.coordinates, selectedRide.destination.coordinates];
    mapRef.current?.fitToCoordinates(coords, {
      edgePadding: {
        top: 170,
        right: 88,
        bottom: bottomOverlayHeight + MARGEN_TOOLTIP_RUTA,
        left: 88,
      },
      animated,
    });
  };

  useEffect(() => {
    fitSelected(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bottomOverlayHeight, selectedId, polyline.length]);

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
        customMapStyle={estiloMapa}
        userInterfaceStyle={modoMapa}
        pitchEnabled={false}
        onRegionChangeComplete={actualizarRumbo}
        onMapReady={() => fitSelected(false)}
        onLayout={() => fitSelected(false)}>
        <RoutePolyline coordinates={polyline} />
        {/* Los orígenes alternativos quedan como referencias discretas. El A y
            B activos se renderizan después y con mayor z-index para que nunca
            queden tapados por otro marcador o por la ruta en Google Maps. */}
        {rides
          .filter((ride) => ride.id !== selectedRide?.id)
          .map((ride) => (
            <RoutePinMarker
              key={`inactive-a-${ride.id}`}
              kind="A"
              coordinate={ride.origin.coordinates}
              label={`Origen: ${getPlaceStreetName(ride.origin)}`}
              showTooltip={false}
              dim
              zIndex={4}
              onPress={() => select(ride, rides.findIndex((item) => item.id === ride.id))}
            />
          ))}
        {selectedRide && (
          <>
            <RoutePinMarker
              key={`selected-a-${selectedRide.id}`}
              kind="A"
              coordinate={selectedRide.origin.coordinates}
              ruta={polyline}
              rumboMapa={rumboMapa}
              zoomMapa={zoomMapa}
              label={`Origen: ${getPlaceStreetName(selectedRide.origin)}`}
              zIndex={20}
            />
            <RoutePinMarker
              key={`selected-b-${selectedRide.id}`}
              kind="B"
              coordinate={selectedRide.destination.coordinates}
              ruta={polyline}
              rumboMapa={rumboMapa}
              zoomMapa={zoomMapa}
              label={`Destino: ${getPlaceStreetName(selectedRide.destination)}`}
              zIndex={21}
            />
          </>
        )}
      </MapView>

      <SafeAreaView
        edges={['bottom']}
        style={styles.bottomWrap}
        pointerEvents="box-none"
        onLayout={(event) => setBottomOverlayHeight(event.nativeEvent.layout.height)}>
        {rides.length > 1 && (
          <View style={styles.pager}>
            <TouchableOpacity
              style={[styles.pagerButton, selectedIndex <= 0 && styles.pagerButtonDisabled]}
              onPress={() => selectIndex(selectedIndex - 1)}
              disabled={selectedIndex <= 0}
              accessibilityRole="button"
              accessibilityLabel="Ver solicitud anterior">
              <Ionicons
                name="chevron-back"
                size={20}
                color={selectedIndex <= 0 ? colors.placeholder : colors.primary}
              />
            </TouchableOpacity>

            <View style={styles.pagerCopy} accessibilityLiveRegion="polite">
              <View style={styles.pagerTitleRow}>
                <Ionicons name="swap-horizontal" size={16} color={colors.primary} />
                <Text style={styles.pagerTitle}>
                  Solicitud {selectedIndex + 1} de {rides.length}
                </Text>
              </View>
              <Text style={styles.pagerHint}>Desliza para ver las demás</Text>
            </View>

            <TouchableOpacity
              style={[
                styles.pagerButton,
                selectedIndex >= rides.length - 1 && styles.pagerButtonDisabled,
              ]}
              onPress={() => selectIndex(selectedIndex + 1)}
              disabled={selectedIndex >= rides.length - 1}
              accessibilityRole="button"
              accessibilityLabel="Ver solicitud siguiente">
              <Ionicons
                name="chevron-forward"
                size={20}
                color={
                  selectedIndex >= rides.length - 1 ? colors.placeholder : colors.primary
                }
              />
            </TouchableOpacity>
          </View>
        )}

        <FlatList
          ref={listRef}
          data={rides}
          horizontal
          showsHorizontalScrollIndicator={false}
          snapToInterval={cardWidth}
          decelerationRate="fast"
          disableIntervalMomentum
          keyExtractor={(r) => r.id}
          getItemLayout={(_, index) => ({
            length: cardWidth,
            offset: cardWidth * index,
            index,
          })}
          onMomentumScrollEnd={(e) => {
            // Al deslizar, la solicitud visible pasa a ser la activa (encuadre + B).
            const index = Math.round(e.nativeEvent.contentOffset.x / cardWidth);
            const ride = rides[index];
            if (ride) setSelectedId(ride.id);
          }}
          renderItem={({ item }) => (
            <View style={{ width: cardWidth }}>
              <MapCard
                ride={item}
                offered={isOffered(item.id)}
                rejected={rejected.has(item.id)}
                expired={expired.has(item.id)}
                paused={paused.has(item.id)}
                taken={taken.has(item.id)}
                disabled={disabled}
                pendingAccept={pendingRideId === item.id}
                offerExpiresAt={offeredMap[item.id]?.expiresAt ?? null}
                offerPrice={offeredMap[item.id]?.price ?? null}
                onPress={
                  isOffered(item.id) || rejected.has(item.id) || expired.has(item.id)
                    ? () => onOpenDetail(item)
                    : undefined
                }
                onAccept={() => onAccept(item)}
                onDismiss={() => onDismiss(item)}
                onQuickAdd={(delta) => onQuickAdd(item, delta)}
                onOpenPriceInput={() => onOpenPriceInput(item)}
                onWithdraw={() => onWithdraw(item)}
              />
            </View>
          )}
          onEndReached={hasNextPage ? onEndReached : undefined}
          onEndReachedThreshold={0.35}
          ListFooterComponent={
            isFetchingNextPage ? (
              <View style={styles.pageLoader}>
                <ActivityIndicator color={colors.primary} size="small" />
              </View>
            ) : null
          }
          accessibilityLabel={`Carrusel con ${rides.length} solicitudes`}
          accessibilityHint="Desliza horizontalmente para cambiar de solicitud"
        />
      </SafeAreaView>
    </View>
  );
}

/** Tarjeta flotante de la solicitud seleccionada en el mapa (sin swipe). */
function MapCard({
  ride,
  offered,
  rejected,
  expired,
  paused,
  taken,
  disabled,
  pendingAccept,
  offerExpiresAt,
  offerPrice,
  onPress,
  onAccept,
  onDismiss,
  onQuickAdd,
  onOpenPriceInput,
  onWithdraw,
}: {
  ride: OpenRide;
  offered: boolean;
  rejected: boolean;
  expired: boolean;
  paused: boolean;
  taken: boolean;
  disabled: boolean;
  pendingAccept: boolean;
  offerExpiresAt: string | null;
  /** Precio que el conductor ofertó (mostrado cuando `offered`). */
  offerPrice: number | null;
  onPress?: () => void;
  onAccept: () => void;
  onDismiss: () => void;
  onQuickAdd: (delta: number) => void;
  onOpenPriceInput: () => void;
  onWithdraw: () => void;
}) {
  const { colors, styles } = useEstilos(crearEstilos);
  const secondsLeft = useCountdown(offerExpiresAt);
  const tripKm = haversineKm(ride.origin.coordinates, ride.destination.coordinates);
  // Con oferta enviada mostramos el monto que el conductor propuso (no el fare
  // del pasajero), para que vea su contraoferta reflejada en la tarjeta.
  const displayPrice = offered && offerPrice != null ? offerPrice : ride.fare;
  const perKm = pricePerKm(displayPrice, tripKm);
  const { rider } = ride;
  const customerNoun = ride.service === 'delivery' ? 'remitente' : 'pasajero';
  const requestNoun = ride.service === 'delivery' ? 'entrega' : 'viaje';
  const initial = rider.fullName.trim().charAt(0).toUpperCase() || '?';
  const meta = [
    SERVICE_META[ride.service].shortLabel,
    `${rider.tripsCompleted} ${rider.tripsCompleted === 1 ? 'viaje' : 'viajes'}`,
    PAYMENT_LABELS[ride.payment],
  ].join(' · ');

  return (
    <TouchableOpacity activeOpacity={0.95} onPress={onPress} style={styles.card}>
      {offered && (
        <Animated.View entering={SlideInDown.duration(200)} style={styles.offeredBanner}>
          <Ionicons name="checkmark-circle" size={15} color={colors.textOnPrimary} />
          <Text style={styles.bannerTextOn}>
            {secondsLeft != null && secondsLeft <= 0 ? 'Expirando…' : 'Oferta enviada'}
          </Text>
          {secondsLeft != null && secondsLeft > 0 && (
            <OfferLifeTimer secondsLeft={secondsLeft} label="" />
          )}
        </Animated.View>
      )}
      {paused && (
        <View style={styles.pausedBanner}>
          <Ionicons name="create-outline" size={15} color={colors.textSecondary} />
          <Text style={styles.bannerTextDark}>
            El {customerNoun} está modificando su solicitud
          </Text>
          <TouchableOpacity
            style={styles.dismissBannerBtn}
            onPress={onDismiss}
            accessibilityRole="button"
            accessibilityLabel="Quitar solicitud del mapa">
            <Text style={styles.dismissBannerBtnText}>Quitar</Text>
          </TouchableOpacity>
        </View>
      )}
      {taken && (
        <View style={styles.takenBanner}>
          <Ionicons name="trophy-outline" size={15} color={colors.textOnPrimary} />
          <Text style={styles.bannerTextOn}>Otro conductor tomó la {requestNoun}</Text>
        </View>
      )}
      {expired && (
        <View style={styles.expiredBanner}>
          <Ionicons name="time-outline" size={15} color={colors.textoSobreAcento} />
          <Text style={styles.bannerTextDark}>Tu oferta expiró · vuelve a ofertar</Text>
        </View>
      )}
      {rejected && (
        <View style={styles.rejectedBanner}>
          <Ionicons name="close-circle" size={15} color={colors.textOnPrimary} />
          <Text style={styles.bannerTextOn}>
            El {customerNoun} no aceptó tu oferta · vuelve a intentarlo
          </Text>
        </View>
      )}

      <View style={styles.cardTop}>
        <View style={styles.avatarWrap}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{initial}</Text>
          </View>
          {rider.rating != null && (
            <View style={styles.ratingBadge}>
              <Text style={styles.ratingBadgeText}>{rider.rating.toFixed(1)}★</Text>
            </View>
          )}
        </View>
        <View style={styles.cardInfo}>
          <Text style={styles.riderName} numberOfLines={1}>
            {rider.fullName}
          </Text>
          <Text style={styles.meta} numberOfLines={1}>
            {meta}
          </Text>
        </View>
        <View style={styles.priceCol}>
          <Text style={styles.fare}>Bs {formatBolivianos(displayPrice)}</Text>
          {offered && offerPrice != null ? (
            <Text style={styles.perKm}>Tu oferta</Text>
          ) : perKm ? (
            <Text style={styles.perKm}>Bs {perKm}/km</Text>
          ) : null}
        </View>
      </View>

      <View style={styles.routeRow}>
        <View style={styles.routeStop}>
          <View style={styles.routeHeading}>
            <View style={[styles.routeBadge, styles.routeBadgeOrigin]}>
              <Text style={styles.routeBadgeText}>A</Text>
            </View>
            <Text style={styles.routeLabel}>ORIGEN</Text>
          </View>
          <Text style={styles.routeText} numberOfLines={1}>
            {ride.origin.name}
          </Text>
        </View>
        <View style={styles.routeStop}>
          <View style={styles.routeHeading}>
            <View style={[styles.routeBadge, styles.routeBadgeDestination]}>
              <Text style={styles.routeBadgeText}>B</Text>
            </View>
            <Text style={styles.routeLabel}>DESTINO</Text>
          </View>
          <Text style={[styles.routeText, styles.routeDestination]} numberOfLines={1}>
            {ride.destination.name} · {formatKm(tripKm)}
          </Text>
        </View>
      </View>

      <View style={styles.quickSlot}>
        {!offered && !paused && !taken && (
          <View style={styles.quickRow}>
            {QUICK_DELTAS.map((delta) => (
              <TouchableOpacity
                key={delta}
                style={[styles.quickPill, disabled && styles.disabled]}
                onPress={() => onQuickAdd(delta)}
                disabled={disabled}
                accessibilityRole="button"
                accessibilityLabel={`Contraofertar con Bs ${delta} más`}>
                <Text style={styles.quickPillText}>+Bs {delta}</Text>
              </TouchableOpacity>
            ))}
            <TouchableOpacity
              style={[styles.keypadBtn, disabled && styles.disabled]}
              onPress={onOpenPriceInput}
              disabled={disabled}
              accessibilityRole="button"
              accessibilityLabel="Contraofertar con un monto personalizado">
              <Ionicons name="create-outline" size={16} color={colors.aviso} />
              <Text style={styles.quickPillText}>Monto</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>

      <View style={styles.actionsSlot}>
        {offered && (
          <View style={styles.actions}>
            <TouchableOpacity
              style={[
                styles.actionBtn,
                styles.decline,
                styles.withdrawAction,
                disabled && styles.disabled,
              ]}
              onPress={onWithdraw}
              disabled={disabled}
              accessibilityRole="button"
              accessibilityLabel="Retirar oferta">
              <Ionicons name="close-circle-outline" size={19} color={colors.danger} />
              <Text style={styles.declineText}>Retirar oferta</Text>
            </TouchableOpacity>
          </View>
        )}
        {!offered &&
          !paused &&
          !taken &&
          (expired || rejected ? (
            <View style={styles.actions}>
              <TouchableOpacity
                style={[styles.actionBtn, styles.accept, disabled && styles.disabled]}
                onPress={onAccept}
                disabled={disabled}
                accessibilityRole="button"
                accessibilityLabel={`Ofertar de nuevo por Bs ${formatBolivianos(ride.fare)}`}>
                {pendingAccept ? (
                  <ActivityIndicator color={colors.textOnPrimary} size="small" />
                ) : (
                  <Text style={styles.acceptText}>Ofertar de nuevo</Text>
                )}
              </TouchableOpacity>
            </View>
          ) : (
            <View style={styles.actions}>
              <TouchableOpacity
                style={[styles.actionBtn, styles.decline, disabled && styles.disabled]}
                onPress={onDismiss}
                disabled={disabled}
                accessibilityRole="button"
                accessibilityLabel="Rechazar solicitud">
                <Text style={styles.declineText}>Rechazar</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.actionBtn, styles.accept, disabled && styles.disabled]}
                onPress={onAccept}
                disabled={disabled}
                accessibilityRole="button"
                accessibilityLabel={`Enviar oferta por Bs ${formatBolivianos(ride.fare)}`}>
                {pendingAccept ? (
                  <View style={styles.acceptWaiting}>
                    <ActivityIndicator color={colors.textOnPrimary} size="small" />
                    <Text style={styles.acceptText}>Enviando…</Text>
                  </View>
                ) : (
                  <Text style={styles.acceptText}>Enviar oferta</Text>
                )}
              </TouchableOpacity>
            </View>
          ))}
      </View>
    </TouchableOpacity>
  );
}

const crearEstilos = ({ colors }: Tema) => StyleSheet.create({
  root: { flex: 1 },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.sm, padding: spacing.xl },
  emptyText: { fontSize: fontSize.md, color: colors.textSecondary, textAlign: 'center' },

  bottomWrap: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: spacing.sm,
    paddingBottom: spacing.sm,
    gap: spacing.sm,
  },
  pageLoader: {
    width: spacing.xxl,
    alignItems: 'center',
    justifyContent: 'center',
  },

  pager: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'center',
    gap: spacing.sm,
    padding: spacing.xs,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    shadowColor: '#000',
    shadowOpacity: 0.14,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 7,
  },
  pagerButton: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.pill,
    backgroundColor: colors.primarioSuave,
  },
  pagerButtonDisabled: { backgroundColor: colors.surfaceMuted },
  pagerCopy: { minWidth: 146, alignItems: 'center' },
  pagerTitleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  pagerTitle: { color: colors.text, fontSize: fontSize.sm, fontWeight: fontWeight.bold },
  pagerHint: { marginTop: 1, color: colors.textSecondary, fontSize: 10 },

  card: {
    padding: spacing.md,
    gap: spacing.md,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
    elevation: 10,
  },
  cardTop: { flexDirection: 'row', gap: spacing.md },
  avatarWrap: { width: 48, height: 48 },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: radius.pill,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { color: colors.textOnPrimary, fontSize: fontSize.lg, fontWeight: fontWeight.bold },
  ratingBadge: {
    position: 'absolute',
    bottom: -3,
    right: -6,
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: radius.pill,
    backgroundColor: colors.accent,
    borderWidth: 2,
    borderColor: colors.surface,
  },
  ratingBadgeText: { color: colors.textoSobreAcento, fontSize: 10, fontWeight: fontWeight.bold },
  cardInfo: { flex: 1, gap: 3, justifyContent: 'center' },
  riderName: { fontSize: fontSize.md, fontWeight: fontWeight.bold, color: colors.text },
  meta: { fontSize: fontSize.xs, color: colors.textSecondary },
  priceCol: { alignItems: 'flex-end', justifyContent: 'center' },
  fare: { fontSize: fontSize.xl, fontWeight: fontWeight.bold, color: colors.primary },
  perKm: { fontSize: 10, color: colors.textSecondary, fontWeight: fontWeight.semibold, marginTop: 2 },

  // Banners de estado (full-width arriba de la card, con curva superior).
  offeredBanner: {
    minHeight: 42,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    marginHorizontal: -spacing.md,
    marginTop: -spacing.md,
    marginBottom: -spacing.xs,
    paddingVertical: spacing.xs + 2,
    paddingHorizontal: spacing.md,
    backgroundColor: colors.success,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
  },
  pausedBanner: {
    minHeight: 42,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    marginHorizontal: -spacing.md,
    marginTop: -spacing.md,
    marginBottom: -spacing.xs,
    paddingVertical: spacing.xs + 2,
    paddingHorizontal: spacing.md,
    backgroundColor: colors.surfaceMuted,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
  },
  expiredBanner: {
    minHeight: 42,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    marginHorizontal: -spacing.md,
    marginTop: -spacing.md,
    marginBottom: -spacing.xs,
    paddingVertical: spacing.xs + 2,
    paddingHorizontal: spacing.md,
    backgroundColor: colors.accent,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
  },
  rejectedBanner: {
    minHeight: 42,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    marginHorizontal: -spacing.md,
    marginTop: -spacing.md,
    marginBottom: -spacing.xs,
    paddingVertical: spacing.xs + 2,
    paddingHorizontal: spacing.md,
    backgroundColor: colors.danger,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
  },
  bannerTextOn: { color: colors.textOnPrimary, fontSize: fontSize.xs, fontWeight: fontWeight.bold },
  bannerTextDark: { color: colors.text, fontSize: fontSize.xs, fontWeight: fontWeight.bold },
  dismissBannerBtn: {
    marginLeft: 'auto',
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  dismissBannerBtnText: { color: colors.textSecondary, fontSize: fontSize.xs, fontWeight: fontWeight.bold },
  takenBanner: {
    minHeight: 42,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    marginHorizontal: -spacing.md,
    marginTop: -spacing.md,
    marginBottom: -spacing.xs,
    paddingVertical: spacing.xs + 2,
    paddingHorizontal: spacing.md,
    backgroundColor: colors.primary,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
  },
  // Mantiene alineadas las cards aunque el estado oculte los controles.
  quickSlot: { minHeight: 34 },
  quickRow: { flexDirection: 'row', gap: spacing.xs },
  quickPill: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs + 2,
    borderRadius: radius.pill,
    backgroundColor: colors.avisoSuave,
    borderWidth: 1,
    borderColor: 'rgba(245,197,24,0.5)',
  },
  keypadBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs + 2,
    borderRadius: radius.pill,
    backgroundColor: colors.avisoSuave,
    borderWidth: 1,
    borderColor: 'rgba(245,197,24,0.5)',
    marginLeft: 'auto',
  },
  quickPillText: { color: colors.aviso, fontSize: fontSize.sm, fontWeight: fontWeight.bold },

  routeRow: { flexDirection: 'row', gap: spacing.md },
  routeStop: { flex: 1, minWidth: 0 },
  routeHeading: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, marginBottom: 3 },
  routeBadge: {
    width: 20,
    height: 20,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.pill,
  },
  routeBadgeOrigin: { backgroundColor: colors.primary },
  routeBadgeDestination: { backgroundColor: colors.danger },
  routeBadgeText: { color: colors.textOnPrimary, fontSize: 10, fontWeight: fontWeight.bold },
  routeLabel: { fontSize: 10, color: colors.textSecondary, fontWeight: fontWeight.bold, letterSpacing: 0.5, marginBottom: 1 },
  routeText: { fontSize: fontSize.sm, color: colors.text },
  routeDestination: { fontWeight: fontWeight.semibold },

  actionsSlot: { minHeight: 46 },
  actions: { flexDirection: 'row', gap: spacing.sm },
  actionBtn: { flex: 1, height: 46, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
  withdrawAction: { flexDirection: 'row', gap: spacing.xs },
  decline: { flex: 1, backgroundColor: colors.peligroSuave, borderWidth: 1, borderColor: colors.bordePeligro },
  declineText: { color: colors.danger, fontSize: fontSize.md, fontWeight: fontWeight.bold },
  accept: { flex: 1.6, backgroundColor: colors.primary },
  acceptText: { color: colors.textOnPrimary, fontSize: fontSize.md, fontWeight: fontWeight.bold },
  acceptWaiting: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  disabled: { opacity: 0.5 },

});
