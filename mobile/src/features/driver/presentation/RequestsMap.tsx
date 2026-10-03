/**
 * Requests on a map (driver).
 *
 * The driver's vehicle, a dashed line from it to the selected pickup and that
 * request's A → B route; every other request is a price pin (green once
 * offered). The camera frames the driver, the pickup and the route. At the
 * bottom, the same `RequestCard` as the list in its compact variant, in a
 * swipeable carousel with the pager inside the card.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  StyleSheet,
  useWindowDimensions,
  View,
} from 'react-native';
import MapView, { Polyline, PROVIDER_GOOGLE, type Region } from 'react-native-maps';
import { SafeAreaView } from 'react-native-safe-area-context';

import { spacing, useThemedStyles, type Theme } from '@/core/theme';
import type { VehicleType } from '@/features/auth/domain/types';
import { useRoute } from '@/features/booking/application/useRoute';
import { getPlaceStreetName } from '@/features/booking/domain/placeLabels';
import type { Coordinates } from '@/features/booking/domain/types';
import { useMapStyle } from '@/features/booking/presentation/mapStyle';
import type { SentOffer } from '@/features/driver/application/useDriverRequests';
import { useMapBearing } from '@/features/rides/application/useMapBearing';
import { formatBolivianos } from '@/features/rides/domain/money';
import type { OpenRide } from '@/features/rides/domain/types';
import { MotorcycleRouteNotice } from '@/features/rides/presentation/MotorcycleRouteNotice';
import { RoutePinMarker } from '@/features/rides/presentation/RoutePinMarker';
import { RoutePolyline } from '@/features/rides/presentation/RoutePolyline';
import { getTripMapPadding } from '@/features/rides/presentation/tripMapLayout';
import { RequestCard } from './RequestCard';
import { RequestPriceMarker } from './RequestPriceMarker';
import { VehicleMarker } from './VehicleMarker';

type Props = {
  /** Requests in the order the list shows them. */
  rides: OpenRide[];
  topOverlayHeight?: number;
  /** Live GPS fix of the driver (vehicle marker and approach line). */
  driver: { coordinates: Coordinates | null; heading: number | null; vehicleType: VehicleType | null };
  /** ~100 m grid of the driver's position: cards and framing ignore 1 s jitter. */
  driverGridCoordinates: Coordinates | null;
  disabled: boolean;
  isOffered: (rideId: string) => boolean;
  pendingRideIds: ReadonlySet<string>;
  /** The driver's sent offers (amount and expiry countdown). */
  offeredMap: Record<string, SentOffer>;
  rejected: Set<string>;
  expired: Set<string>;
  paused: Set<string>;
  taken: Set<string>;
  /** Ride to select when opening the map (when tapping a card from the list). */
  initialSelectedId?: string | null;
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  onEndReached: () => void;
  onOpenDetail: (ride: OpenRide) => void;
  onAccept: (ride: OpenRide) => void;
  onDismiss: (ride: OpenRide) => void;
  onCounterOffer: (ride: OpenRide) => void;
  onWithdraw: (ride: OpenRide) => void;
};

export function RequestsMap({
  rides,
  topOverlayHeight = 140,
  driver,
  driverGridCoordinates,
  disabled,
  isOffered,
  pendingRideIds,
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
  onCounterOffer,
  onWithdraw,
}: Props) {
  const { colors, styles } = useThemedStyles(createStyles);
  const mapRef = useRef<MapView>(null);
  const [mapReady, setMapReady] = useState(false);
  const [mapSize, setMapSize] = useState({ width: 0, height: 0 });
  const { mapStyle, mapMode } = useMapStyle(true);
  const { mapBearing, mapZoom, updateBearing } = useMapBearing(mapRef);
  const listRef = useRef<FlatList<OpenRide>>(null);
  const { width: windowWidth } = useWindowDimensions();
  const cardWidth = windowWidth - spacing.sm * 2;
  const [selectedId, setSelectedId] = useState<string | null>(initialSelectedId ?? null);
  const [bottomOverlayHeight, setBottomOverlayHeight] = useState(320);
  const [noticeHeight, setNoticeHeight] = useState(0);

  const selectedRide = rides.find((r) => r.id === selectedId) ?? rides[0] ?? null;
  const selectedIndex = rides.findIndex((r) => r.id === selectedRide?.id);
  const motoNotice = selectedRide?.service === 'moto';

  // Change the active request and sync the carousel (marker or pager tap).
  const select = (ride: OpenRide, index?: number) => {
    setSelectedId(ride.id);
    if (index != null && index >= 0) listRef.current?.scrollToIndex({ index, animated: true });
  };
  const selectIndex = (index: number) => {
    const ride = rides[index];
    if (ride) select(ride, index);
  };
  const { route } = useRoute(selectedRide?.origin ?? null, selectedRide?.destination ?? null, selectedRide?.service ?? 'taxi');

  const polyline = useMemo<Coordinates[]>(() => route?.coordinates.length
    ? route.coordinates : selectedRide
      ? [selectedRide.origin.coordinates, selectedRide.destination.coordinates] : [],
  [route, selectedRide]);

  const fitSelected = useCallback(() => {
    if (!mapReady || mapSize.width <= 0 || mapSize.height <= 0 || polyline.length < 2) return;
    const points = driverGridCoordinates ? [...polyline, driverGridCoordinates] : polyline;
    mapRef.current?.fitToCoordinates(points, {
      edgePadding: getTripMapPadding(mapSize.width, mapSize.height,
        topOverlayHeight + (motoNotice ? noticeHeight : 0), bottomOverlayHeight, 72, 88),
      animated: false,
    });
  }, [mapReady, mapSize.width, mapSize.height, polyline, driverGridCoordinates, bottomOverlayHeight,
    topOverlayHeight, motoNotice, noticeHeight]);

  useEffect(() => { fitSelected(); }, [fitSelected]);

  const start = driver.coordinates ?? rides[0]?.origin.coordinates ?? null;
  const initialRegion: Region | undefined = start
    ? { latitude: start.latitude, longitude: start.longitude, latitudeDelta: 0.05, longitudeDelta: 0.05 }
    : undefined;

  if (!initialRegion || !selectedRide) return <View style={styles.root} />;

  const selectedPrice = isOffered(selectedRide.id) && offeredMap[selectedRide.id]
    ? offeredMap[selectedRide.id].price : selectedRide.fare;

  return (
    <View style={styles.root}>
      <MapView
        ref={mapRef}
        provider={PROVIDER_GOOGLE}
        showsBuildings={false}
        showsIndoors={false}
        showsIndoorLevelPicker={false}
        style={StyleSheet.absoluteFill}
        initialRegion={initialRegion}
        customMapStyle={mapStyle}
        userInterfaceStyle={mapMode}
        pitchEnabled={false}
        scrollEnabled={false}
        zoomEnabled={false}
        rotateEnabled={false}
        zoomTapEnabled={false}
        toolbarEnabled={false}
        moveOnMarkerPress={false}
        onRegionChangeComplete={updateBearing}
        onMapReady={() => setMapReady(true)}
        onLayout={({ nativeEvent: { layout } }) => setMapSize((current) =>
          current.width === layout.width && current.height === layout.height
            ? current : { width: layout.width, height: layout.height })}>
        <RoutePolyline coordinates={route?.coordinates ?? []} />
        {driver.coordinates && (
          <Polyline
            coordinates={[driver.coordinates, selectedRide.origin.coordinates]}
            strokeColor={colors.primary}
            strokeWidth={3}
            lineDashPattern={[16, 20]}
            zIndex={3}
          />
        )}
        {/* Other requests stay as price pins; the selected A and B render last and on top. */}
        {rides
          .filter((ride) => ride.id !== selectedRide.id)
          .map((ride) => {
            const offered = isOffered(ride.id);
            return (
              <RequestPriceMarker
                key={`price-${ride.id}`}
                coordinate={ride.origin.coordinates}
                price={offered && offeredMap[ride.id] ? offeredMap[ride.id].price : ride.fare}
                offered={offered}
                label={`Solicitud de ${ride.rider.fullName} en ${getPlaceStreetName(ride.origin)}`}
                onPress={() => select(ride, rides.findIndex((item) => item.id === ride.id))}
              />
            );
          })}
        <RoutePinMarker
          key={`selected-a-${selectedRide.id}`}
          kind="A"
          coordinate={selectedRide.origin.coordinates}
          route={polyline}
          mapBearing={mapBearing}
          mapZoom={mapZoom}
          label={`Bs ${formatBolivianos(selectedPrice)}`}
          zIndex={20}
        />
        <RoutePinMarker
          key={`selected-b-${selectedRide.id}`}
          kind="B"
          coordinate={selectedRide.destination.coordinates}
          route={polyline}
          mapBearing={mapBearing}
          mapZoom={mapZoom}
          label={`Destino: ${getPlaceStreetName(selectedRide.destination)}`}
          zIndex={21}
        />
        {driver.coordinates && (
          <VehicleMarker coordinates={driver.coordinates} heading={driver.heading} vehicleType={driver.vehicleType} />
        )}
      </MapView>

      {motoNotice && (
        <View style={[styles.notice, { top: topOverlayHeight }]}
          onLayout={(event) => setNoticeHeight(event.nativeEvent.layout.height)}>
          <MotorcycleRouteNotice service="moto" />
        </View>
      )}

      <SafeAreaView
        edges={['bottom']}
        style={styles.bottomWrap}
        pointerEvents="box-none"
        onLayout={(event) => setBottomOverlayHeight(event.nativeEvent.layout.height)}>
        <FlatList
          ref={listRef}
          data={rides}
          horizontal
          showsHorizontalScrollIndicator={false}
          snapToInterval={cardWidth}
          decelerationRate="fast"
          disableIntervalMomentum
          keyExtractor={(r) => r.id}
          initialScrollIndex={selectedIndex > 0 ? selectedIndex : undefined}
          getItemLayout={(_, index) => ({ length: cardWidth, offset: cardWidth * index, index })}
          contentContainerStyle={styles.carousel}
          onMomentumScrollEnd={(e) => {
            // On swipe, the visible request becomes the active one (framing + B).
            const ride = rides[Math.round(e.nativeEvent.contentOffset.x / cardWidth)];
            if (ride) setSelectedId(ride.id);
          }}
          renderItem={({ item, index }) => (
            <View style={{ width: cardWidth }}>
              <RequestCard
                variant="map"
                ride={item}
                offered={isOffered(item.id)}
                rejected={rejected.has(item.id)}
                expired={expired.has(item.id)}
                paused={paused.has(item.id)}
                taken={taken.has(item.id)}
                disabled={disabled || pendingRideIds.has(item.id)}
                pendingAccept={pendingRideIds.has(item.id)}
                offerExpiresAt={offeredMap[item.id]?.expiresAt ?? null}
                offerPrice={offeredMap[item.id]?.price ?? null}
                driverCoordinates={driverGridCoordinates}
                route={item.id === selectedRide.id && route
                  ? { distanceMeters: route.distanceMeters, durationSeconds: route.durationSeconds } : null}
                pager={rides.length > 1 ? {
                  index,
                  total: rides.length,
                  onPrevious: () => selectIndex(index - 1),
                  onNext: () => selectIndex(index + 1),
                } : undefined}
                onPress={isOffered(item.id) || rejected.has(item.id) || expired.has(item.id)
                  ? () => onOpenDetail(item) : undefined}
                onViewOffer={() => onOpenDetail(item)}
                onAccept={() => onAccept(item)}
                onDismiss={() => onDismiss(item)}
                onCounterOffer={() => onCounterOffer(item)}
                onWithdraw={() => onWithdraw(item)}
              />
            </View>
          )}
          onEndReached={hasNextPage ? onEndReached : undefined}
          onEndReachedThreshold={0.35}
          ListFooterComponent={isFetchingNextPage ? (
            <View style={styles.pageLoader}>
              <ActivityIndicator color={colors.primary} size="small" />
            </View>
          ) : null}
          accessibilityLabel={`Carrusel con ${rides.length} solicitudes`}
          accessibilityHint="Desliza horizontalmente para cambiar de solicitud"
        />
      </SafeAreaView>
    </View>
  );
}

const createStyles = ({ colors }: Theme) => StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surfaceMuted },
  notice: { position: 'absolute', left: spacing.sm + 4, right: spacing.sm + 4 },
  bottomWrap: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: spacing.sm,
    paddingBottom: spacing.sm,
  },
  // Shorter cards (a status band collapses the route) sit on the same baseline.
  carousel: { alignItems: 'flex-end' },
  pageLoader: { width: spacing.xxl, alignSelf: 'center', alignItems: 'center', justifyContent: 'center' },
});
