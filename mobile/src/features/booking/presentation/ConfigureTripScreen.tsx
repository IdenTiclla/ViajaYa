/**
 * Configurar viaje — paso final del flujo: muestra origen y destino marcados en
 * el mapa, unidos por el trayecto real por calles (Google Routes API), y permite
 * elegir servicio, proponer una oferta y buscar ofertas de conductores.
 *
 * Si el cálculo del trayecto falla (key restringida, sin red), cae a una línea
 * recta entre ambos puntos.
 */
import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import MapView, { Marker, Polyline, PROVIDER_GOOGLE, type Region } from 'react-native-maps';
import { SafeAreaView } from 'react-native-safe-area-context';

import { getApiErrorMessage } from '@/core/errors/apiError';
import { useKeyboardHeight } from '@/core/hooks/useKeyboardHeight';
import { colors, fontSize, fontWeight, radius, spacing } from '@/core/theme';
import { useBookingStore } from '@/features/booking/application/useBookingStore';
import { useRoute } from '@/features/booking/application/useRoute';
import { ridesRepository } from '@/features/booking/data/ridesRepository';
import type { Coordinates, ServiceType } from '@/features/booking/domain/types';
import { declutteredMapStyle } from '@/features/booking/presentation/mapStyle';

const SERVICES: { id: ServiceType; label: string; icon: 'car-sport' | 'bicycle' }[] = [
  { id: 'taxi', label: 'Taxi', icon: 'car-sport' },
  { id: 'moto', label: 'Moto', icon: 'bicycle' },
];

// Márgenes del encuadre: arriba deja sitio a la barra superior; abajo es dinámico
// (alto real del bottom sheet) para que ambos puntos queden en el área visible.
const FIT_TOP = 120;
const FIT_SIDES = 60;

function formatDistance(meters: number): string {
  return meters >= 1000 ? `${(meters / 1000).toFixed(1)} km` : `${Math.round(meters)} m`;
}

function formatDuration(seconds: number): string {
  return `${Math.max(1, Math.round(seconds / 60))} min`;
}

export function ConfigureTripScreen() {
  const router = useRouter();
  const origin = useBookingStore((s) => s.origin);
  const destination = useBookingStore((s) => s.destination);
  const service = useBookingStore((s) => s.service);
  const setService = useBookingStore((s) => s.setService);
  const fare = useBookingStore((s) => s.fare);
  const setFare = useBookingStore((s) => s.setFare);
  const mapRef = useRef<MapView>(null);
  const queryClient = useQueryClient();
  // Alto real del bottom sheet, para encuadrar los puntos por encima de él.
  const [sheetHeight, setSheetHeight] = useState(0);
  const keyboardHeight = useKeyboardHeight();
  // Mostrar/ocultar etiquetas de lugares (el usuario lo controla con el toggle).
  const [showPlaces, setShowPlaces] = useState(true);

  const createRide = useMutation({
    mutationFn: ridesRepository.create,
    onSuccess: () => {
      // Refresca los recientes (este destino pasa a estar entre ellos).
      void queryClient.invalidateQueries({ queryKey: ['recent-destinations'] });
      router.push('/booking/offers');
    },
  });

  const { route, isLoading: routeLoading } = useRoute(origin, destination);

  const region = useMemo<Region | undefined>(() => {
    if (!origin || !destination) return undefined;
    const a = origin.coordinates;
    const b = destination.coordinates;
    return {
      latitude: (a.latitude + b.latitude) / 2,
      longitude: (a.longitude + b.longitude) / 2,
      latitudeDelta: Math.max(Math.abs(a.latitude - b.latitude) * 1.8, 0.02),
      longitudeDelta: Math.max(Math.abs(a.longitude - b.longitude) * 1.8, 0.02),
    };
  }, [origin, destination]);

  // Para encuadrar la cámara: el trayecto real si existe, si no la recta entre
  // ambos puntos (así el mapa enmarca el viaje desde el primer instante).
  const fitCoordinates = useMemo<Coordinates[]>(() => {
    if (route?.coordinates.length) return route.coordinates;
    if (origin && destination) return [origin.coordinates, destination.coordinates];
    return [];
  }, [route, origin, destination]);

  // Para dibujar: la recta solo aparece como fallback cuando el cálculo del
  // trayecto terminó sin ruta; mientras carga no se dibuja, para evitar el
  // "salto" visual de recta → trayecto por calles.
  const polylineCoordinates = useMemo<Coordinates[]>(() => {
    if (route?.coordinates.length) return route.coordinates;
    if (routeLoading) return [];
    if (origin && destination) return [origin.coordinates, destination.coordinates];
    return [];
  }, [route, routeLoading, origin, destination]);

  // Encuadra origen + destino dejando libre el área que tapa el bottom sheet.
  const fitToTrip = useCallback(
    (animated: boolean) => {
      if (fitCoordinates.length < 2) return;
      mapRef.current?.fitToCoordinates(fitCoordinates, {
        edgePadding: { top: FIT_TOP, right: FIT_SIDES, bottom: sheetHeight + 24, left: FIT_SIDES },
        animated,
      });
    },
    [fitCoordinates, sheetHeight],
  );

  // Reajusta la cámara cuando llega/cambia el trayecto o se mide el sheet.
  useEffect(() => {
    fitToTrip(true);
  }, [fitToTrip]);

  if (!origin || !destination || !region) {
    return (
      <SafeAreaView style={[styles.root, styles.fallback]}>
        <Ionicons name="map-outline" size={48} color={colors.textSecondary} />
        <Text style={styles.fallbackText}>Define el origen y el destino para continuar.</Text>
        <TouchableOpacity
          style={styles.fallbackButton}
          onPress={() => router.replace('/booking/destination')}
          accessibilityRole="button">
          <Text style={styles.fallbackButtonText}>Elegir destino</Text>
        </TouchableOpacity>
      </SafeAreaView>
    );
  }

  const fareValue = Number.parseFloat(fare.replace(',', '.'));
  const fareIsValid = Number.isFinite(fareValue) && fareValue > 0;

  const searchOffers = () => {
    if (!fareIsValid || createRide.isPending) return;
    createRide.mutate({ origin, destination, service, fare: fareValue });
  };

  return (
    <View style={styles.root}>
      <MapView
        ref={mapRef}
        provider={PROVIDER_GOOGLE}
        style={StyleSheet.absoluteFill}
        initialRegion={region}
        customMapStyle={showPlaces ? [] : declutteredMapStyle}
        onMapReady={() => fitToTrip(false)}>
        <Marker coordinate={origin.coordinates} anchor={{ x: 0.5, y: 0.5 }} title={origin.name}>
          <View style={styles.originDot} />
        </Marker>
        <Marker coordinate={destination.coordinates} title={destination.name} pinColor={colors.danger} />
        {polylineCoordinates.length >= 2 && (
          <>
            {/* Contorno blanco para que la ruta resalte sobre calles y etiquetas. */}
            <Polyline coordinates={polylineCoordinates} strokeColor={colors.surface} strokeWidth={9} />
            <Polyline coordinates={polylineCoordinates} strokeColor={colors.primary} strokeWidth={5} />
          </>
        )}
      </MapView>

      <SafeAreaView style={styles.topBar} edges={['top']} pointerEvents="box-none">
        <TouchableOpacity
          style={styles.back}
          onPress={() => router.back()}
          accessibilityRole="button"
          accessibilityLabel="Volver">
          <Ionicons name="arrow-back" size={24} color={colors.text} />
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.back}
          onPress={() => setShowPlaces((v) => !v)}
          accessibilityRole="button"
          accessibilityState={{ selected: showPlaces }}
          accessibilityLabel={showPlaces ? 'Ocultar nombres de lugares' : 'Mostrar nombres de lugares'}>
          <Ionicons
            name={showPlaces ? 'business' : 'business-outline'}
            size={22}
            color={showPlaces ? colors.primary : colors.textSecondary}
          />
        </TouchableOpacity>
      </SafeAreaView>

      <SafeAreaView
        style={[styles.sheet, keyboardHeight > 0 && { bottom: keyboardHeight }]}
        edges={['bottom']}
        onLayout={(e) => setSheetHeight(e.nativeEvent.layout.height)}>
        <View style={styles.route}>
          <View style={styles.routeIcons}>
            <View style={styles.originDotSmall} />
            <View style={styles.routeLine} />
            <Ionicons name="location" size={18} color={colors.danger} />
          </View>
          <View style={styles.routeText}>
            <View style={styles.routeRow}>
              <View style={styles.routeRowHeader}>
                <Text style={styles.routeLabel}>Punto de partida</Text>
                <TouchableOpacity
                  onPress={() =>
                    router.push({ pathname: '/booking/pick-on-map', params: { target: 'origin' } })
                  }
                  accessibilityRole="button"
                  accessibilityLabel="Cambiar punto de partida">
                  <Text style={styles.editLink}>Editar</Text>
                </TouchableOpacity>
              </View>
              <Text style={styles.routeValue} numberOfLines={1}>
                {origin.name} · {origin.address}
              </Text>
            </View>
            <View style={styles.routeRow}>
              <View style={styles.routeRowHeader}>
                <Text style={styles.routeLabel}>Destino</Text>
                <TouchableOpacity
                  onPress={() => router.push('/booking/destination')}
                  accessibilityRole="button"
                  accessibilityLabel="Cambiar destino">
                  <Text style={styles.editLink}>Editar</Text>
                </TouchableOpacity>
              </View>
              <Text style={styles.routeValue} numberOfLines={1}>
                {destination.name} · {destination.address}
              </Text>
            </View>
          </View>
        </View>

        {route && (
          <View style={styles.estimate}>
            <Ionicons name="navigate" size={16} color={colors.primary} />
            <Text style={styles.estimateText}>
              {formatDistance(route.distanceMeters)} · {formatDuration(route.durationSeconds)}
            </Text>
          </View>
        )}

        <Text style={styles.fieldLabel}>Tipo de servicio</Text>
        <View style={styles.services}>
          {SERVICES.map((s) => {
            const active = service === s.id;
            return (
              <TouchableOpacity
                key={s.id}
                style={[styles.serviceChip, active && styles.serviceChipActive]}
                onPress={() => setService(s.id)}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                accessibilityLabel={s.label}>
                <Ionicons
                  name={s.icon}
                  size={20}
                  color={active ? colors.textOnPrimary : colors.text}
                />
                <Text style={[styles.serviceChipText, active && styles.serviceChipTextActive]}>
                  {s.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>

        <Text style={styles.fieldLabel}>Tu oferta</Text>
        <View style={styles.fareRow}>
          <Text style={styles.fareCurrency}>Bs</Text>
          <TextInput
            style={styles.fareInput}
            value={fare}
            onChangeText={setFare}
            placeholder="0.00"
            placeholderTextColor={colors.placeholder}
            keyboardType="decimal-pad"
            returnKeyType="done"
            accessibilityLabel="Monto de tu oferta en bolivianos"
          />
        </View>

        {createRide.isError && (
          <Text style={styles.error}>{getApiErrorMessage(createRide.error)}</Text>
        )}

        <TouchableOpacity
          style={[styles.cta, (!fareIsValid || createRide.isPending) && styles.ctaDisabled]}
          disabled={!fareIsValid || createRide.isPending}
          onPress={searchOffers}
          accessibilityRole="button"
          accessibilityLabel="Buscar ofertas">
          {createRide.isPending ? (
            <ActivityIndicator color={colors.textOnPrimary} />
          ) : (
            <Text style={styles.ctaText}>Buscar Ofertas</Text>
          )}
        </TouchableOpacity>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surfaceMuted },
  fallback: { alignItems: 'center', justifyContent: 'center', gap: spacing.md, padding: spacing.lg },
  fallbackText: { color: colors.textSecondary, fontSize: fontSize.md, textAlign: 'center' },
  fallbackButton: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    backgroundColor: colors.primary,
  },
  fallbackButtonText: { color: colors.textOnPrimary, fontWeight: fontWeight.semibold },

  originDot: {
    width: 18,
    height: 18,
    borderRadius: radius.pill,
    backgroundColor: colors.primary,
    borderWidth: 3,
    borderColor: colors.surface,
  },

  topBar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
  },
  back: {
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

  route: { flexDirection: 'row', gap: spacing.md },
  routeIcons: { alignItems: 'center', paddingTop: 4 },
  originDotSmall: {
    width: 12,
    height: 12,
    borderRadius: radius.pill,
    backgroundColor: colors.primary,
  },
  routeLine: { width: 2, flex: 1, minHeight: 20, backgroundColor: colors.border, marginVertical: 4 },
  routeText: { flex: 1, gap: spacing.md },
  routeRow: { gap: 2 },
  routeRowHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  routeLabel: { fontSize: fontSize.xs, color: colors.textSecondary },
  routeValue: { fontSize: fontSize.md, fontWeight: fontWeight.medium, color: colors.text },
  editLink: { fontSize: fontSize.sm, fontWeight: fontWeight.medium, color: colors.primary },

  estimate: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    alignSelf: 'flex-start',
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceMuted,
  },
  estimateText: { fontSize: fontSize.sm, fontWeight: fontWeight.medium, color: colors.text },

  fieldLabel: { fontSize: fontSize.sm, fontWeight: fontWeight.semibold, color: colors.text },
  services: { flexDirection: 'row', gap: spacing.md },
  serviceChip: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    height: 48,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  serviceChipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  serviceChipText: { fontSize: fontSize.md, fontWeight: fontWeight.medium, color: colors.text },
  serviceChipTextActive: { color: colors.textOnPrimary },

  fareRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    height: 54,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  fareCurrency: { fontSize: fontSize.md, fontWeight: fontWeight.semibold, color: colors.textSecondary },
  fareInput: { flex: 1, fontSize: fontSize.lg, fontWeight: fontWeight.semibold, color: colors.text, padding: 0 },

  cta: {
    height: 56,
    borderRadius: radius.md,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ctaDisabled: { opacity: 0.5 },
  ctaText: { color: colors.textOnPrimary, fontSize: fontSize.md, fontWeight: fontWeight.bold },
  error: { color: colors.danger, fontSize: fontSize.sm, textAlign: 'center' },
});
