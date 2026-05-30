/**
 * Selección de un punto (origen o destino) moviendo el mapa: el pin queda fijo
 * en el centro y el usuario desplaza el mapa hasta el punto deseado. Al
 * confirmar, ese centro se guarda en el store y se vuelve a configurar el viaje.
 *
 * El punto a fijar lo decide el parámetro de ruta `target` ('origin' |
 * 'destination'); por defecto, destino. El pin es azul para el origen y rojo
 * para el destino. El `Place` vive en estado local hasta que se confirma.
 */
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import MapView, { PROVIDER_GOOGLE, type Region } from 'react-native-maps';
import { SafeAreaView } from 'react-native-safe-area-context';

import { colors, fontSize, fontWeight, radius, spacing } from '@/core/theme';
import { useBookingStore } from '@/features/booking/application/useBookingStore';
import { useRegionPlace } from '@/features/booking/application/useRegionPlace';
import type { Place } from '@/features/booking/domain/types';
import { CenterPin } from '@/features/booking/presentation/CenterPin';
import { useCurrentLocation } from '@/features/home/application/useCurrentLocation';
import { locationService } from '@/features/home/data/locationService';

export function PickOnMapScreen() {
  const router = useRouter();
  const { target, saveAs, category, id, label } = useLocalSearchParams<{
    target?: string;
    saveAs?: string;
    category?: string;
    id?: string;
    label?: string;
  }>();
  // Modo "guardar lugar": el confirmar lleva al formulario de lugar guardado en
  // vez de a configurar el viaje. Conserva categoría/id/label para reenviarlos.
  const isSaveAs = saveAs === '1';
  const isOrigin = target === 'origin';
  const noun = isSaveAs ? 'lugar' : isOrigin ? 'origen' : 'destino';
  const pinColor = isSaveAs || isOrigin ? colors.primary : colors.danger;

  const origin = useBookingStore((s) => s.origin);
  const destination = useBookingStore((s) => s.destination);
  const setOrigin = useBookingStore((s) => s.setOrigin);
  const setDestination = useBookingStore((s) => s.setDestination);
  const { coordinates } = useCurrentLocation();
  const mapRef = useRef<MapView>(null);

  // Centra el mapa en el punto que se edita si ya existe; si no, en el origen o
  // en la ubicación actual. Al guardar un lugar, parte del origen/ubicación.
  const initialRegion = useMemo<Region | undefined>(() => {
    const existing = isSaveAs ? undefined : isOrigin ? origin : destination;
    const center = existing?.coordinates ?? origin?.coordinates ?? coordinates;
    if (!center) return undefined;
    return {
      latitude: center.latitude,
      longitude: center.longitude,
      latitudeDelta: 0.01,
      longitudeDelta: 0.01,
    };
  }, [isSaveAs, isOrigin, origin, destination, coordinates]);

  const [place, setPlace] = useState<Place | null>(null);
  const handleRegionChange = useRegionPlace(
    setPlace,
    isSaveAs ? 'Lugar' : isOrigin ? 'Origen' : 'Destino',
  );

  // Siembra la dirección del centro inicial. Solo dispara trabajo asíncrono
  // (el setState ocurre en el `.then`, no de forma síncrona dentro del efecto).
  const seeded = useRef(false);
  useEffect(() => {
    if (!initialRegion || seeded.current) return;
    seeded.current = true;
    const center = { latitude: initialRegion.latitude, longitude: initialRegion.longitude };
    void locationService.reverseGeocode(center).then((label) => setPlace({ coordinates: center, ...label }));
  }, [initialRegion]);

  const recenter = () => {
    if (initialRegion) mapRef.current?.animateToRegion(initialRegion, 400);
  };

  const confirm = () => {
    if (!place) return;
    if (isSaveAs) {
      // Reemplaza el mapa por el formulario para nombrar/categorizar el lugar,
      // reenviando id/label/category (edición) y el punto elegido.
      router.replace({
        pathname: '/booking/edit-place',
        params: {
          ...(id ? { id } : {}),
          ...(label ? { label } : {}),
          ...(category ? { category } : {}),
          lat: String(place.coordinates.latitude),
          lng: String(place.coordinates.longitude),
          name: place.name,
          address: place.address,
        },
      });
      return;
    }
    (isOrigin ? setOrigin : setDestination)(place);
    // `navigate` reutiliza la pantalla de configurar si ya está en la pila
    // (caso edición), o la abre si venimos del flujo de búsqueda.
    router.navigate('/booking/configure');
  };

  if (!initialRegion) {
    return (
      <View style={[styles.root, styles.loading]}>
        <ActivityIndicator size="large" color={colors.primary} />
        <Text style={styles.loadingText}>Cargando mapa…</Text>
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
        showsUserLocation
        showsMyLocationButton={false}
        onRegionChangeComplete={handleRegionChange}
      />

      <CenterPin label={`Fijar ${noun}`} color={pinColor} />

      <SafeAreaView style={styles.topBar} edges={['top']} pointerEvents="box-none">
        <TouchableOpacity
          style={styles.back}
          onPress={() => router.back()}
          accessibilityRole="button"
          accessibilityLabel="Volver">
          <Ionicons name="arrow-back" size={24} color={colors.text} />
        </TouchableOpacity>
        <View style={styles.addressPill}>
          <Ionicons name="location" size={18} color={pinColor} />
          <Text style={styles.addressText} numberOfLines={1}>
            {place?.address ?? `Mueve el mapa para fijar el ${noun}`}
          </Text>
        </View>
      </SafeAreaView>

      <TouchableOpacity
        style={styles.recenter}
        onPress={recenter}
        accessibilityRole="button"
        accessibilityLabel="Centrar en mi ubicación">
        <Ionicons name="locate" size={22} color={colors.primary} />
      </TouchableOpacity>

      <SafeAreaView style={styles.bottom} edges={['bottom']}>
        <View style={styles.card}>
          <Text style={styles.cardLabel}>
            {isSaveAs ? 'NUEVO LUGAR' : isOrigin ? 'PUNTO DE PARTIDA' : 'DESTINO'}
          </Text>
          <Text style={styles.cardValue} numberOfLines={1}>
            {place?.name ?? 'Mueve el mapa'}
          </Text>
          <Text style={styles.cardAddress} numberOfLines={1}>
            {place?.address ?? `para fijar el ${noun}`}
          </Text>
        </View>
        <TouchableOpacity
          style={[styles.confirm, !place && styles.confirmDisabled]}
          disabled={!place}
          onPress={confirm}
          accessibilityRole="button"
          accessibilityLabel={isSaveAs ? 'Usar esta ubicación' : 'Confirmar ubicación'}>
          <Text style={styles.confirmText}>
            {isSaveAs ? 'Usar esta ubicación' : 'Confirmar ubicación'}
          </Text>
          <Ionicons name="arrow-forward" size={20} color={colors.textOnPrimary} />
        </TouchableOpacity>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surfaceMuted },
  loading: { alignItems: 'center', justifyContent: 'center', gap: spacing.sm },
  loadingText: { color: colors.textSecondary, fontSize: fontSize.sm },

  topBar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
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
  addressPill: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    height: 48,
    paddingHorizontal: spacing.md,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    shadowColor: '#000',
    shadowOpacity: 0.1,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 3,
  },
  addressText: { flex: 1, fontSize: fontSize.sm, color: colors.text },

  recenter: {
    position: 'absolute',
    right: spacing.md,
    bottom: 200,
    width: 48,
    height: 48,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.12,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 4,
  },

  bottom: {
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
  card: { gap: spacing.xs },
  cardLabel: {
    fontSize: fontSize.xs,
    fontWeight: fontWeight.semibold,
    color: colors.textSecondary,
    letterSpacing: 0.5,
  },
  cardValue: { fontSize: fontSize.md, fontWeight: fontWeight.semibold, color: colors.text },
  cardAddress: { fontSize: fontSize.sm, color: colors.textSecondary },

  confirm: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    height: 54,
    borderRadius: radius.md,
    backgroundColor: colors.primary,
  },
  confirmDisabled: { opacity: 0.5 },
  confirmText: { color: colors.textOnPrimary, fontSize: fontSize.md, fontWeight: fontWeight.semibold },
});
