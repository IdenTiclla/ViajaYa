/**
 * "Mis lugares guardados": lista los favoritos del pasajero (Casa, Trabajo,
 * Gimnasio, Otros). Permite agregar uno nuevo, editar cada uno, y tocar uno
 * para usarlo como destino del viaje. También ofrece guardar rápido un destino
 * reciente.
 */
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import {
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { getApiErrorMessage } from '@/core/errors/apiError';
import { colors, fontSize, fontWeight, radius, spacing } from '@/core/theme';
import { useBookingStore } from '@/features/booking/application/useBookingStore';
import { useRecentDestinations } from '@/features/booking/application/useRecentDestinations';
import { useSavedPlaces } from '@/features/booking/application/useSavedPlaces';
import {
  getBoliviaPlaceError,
  isPlaceInBolivia,
} from '@/features/booking/domain/bolivia';
import type { Place, SavedPlace } from '@/features/booking/domain/types';
import { CATEGORY_META } from '@/features/booking/presentation/savedPlaceCategory';
import { FeedbackState } from '@/shared/components';

export function SavedPlacesScreen() {
  const router = useRouter();
  const { rideId } = useLocalSearchParams<{ rideId?: string }>();
  const {
    places: saved,
    isLoading,
    isRefreshing,
    isError,
    error,
    refetch,
  } = useSavedPlaces();
  const { places: recents } = useRecentDestinations();
  const setDestination = useBookingStore((s) => s.setDestination);
  const [areaError, setAreaError] = useState<string | null>(null);

  const selectDestination = (place: Place) => {
    const locationError = getBoliviaPlaceError(place);
    if (locationError) {
      setAreaError(locationError);
      return;
    }
    setAreaError(null);
    setDestination(place);
    router.dismissTo({
      pathname: '/booking/configure',
      params: rideId ? { rideId } : {},
    });
  };

  const addNew = () => {
    router.push({
      pathname: '/booking/pick-on-map',
      params: { saveAs: '1', ...(rideId ? { rideId } : {}) },
    });
  };

  const edit = (item: SavedPlace) => {
    router.push({
      pathname: '/booking/edit-place',
      params: {
        id: item.id,
        label: item.label,
        category: item.category,
        lat: String(item.place.coordinates.latitude),
        lng: String(item.place.coordinates.longitude),
        name: item.place.name,
        address: item.place.address,
        ...(rideId ? { rideId } : {}),
        ...(item.place.countryCode ? { countryCode: item.place.countryCode } : {}),
      },
    });
  };

  // Guarda rápido un destino reciente: ya tiene coordenadas, así que va directo
  // al formulario sin pasar por el mapa.
  const quickSave = (place: Place) => {
    const locationError = getBoliviaPlaceError(place);
    if (locationError) {
      setAreaError(locationError);
      return;
    }
    setAreaError(null);
    router.push({
      pathname: '/booking/edit-place',
      params: {
        lat: String(place.coordinates.latitude),
        lng: String(place.coordinates.longitude),
        name: place.name,
        address: place.address,
        label: place.name,
        ...(rideId ? { rideId } : {}),
        ...(place.countryCode ? { countryCode: place.countryCode } : {}),
      },
    });
  };

  // Recientes que aún no están guardados (compara por coordenadas).
  const savedKeys = new Set(
    saved.map(
      (s) => `${s.place.coordinates.latitude.toFixed(5)},${s.place.coordinates.longitude.toFixed(5)}`,
    ),
  );
  const saveableRecents = recents
    .filter(isPlaceInBolivia)
    .filter(
      (r) =>
        !savedKeys.has(
          `${r.coordinates.latitude.toFixed(5)},${r.coordinates.longitude.toFixed(5)}`,
        ),
    )
    .slice(0, 4);

  return (
    <SafeAreaView style={styles.root} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.back}
          onPress={() => router.back()}
          accessibilityRole="button"
          accessibilityLabel="Volver">
          <Ionicons name="arrow-back" size={24} color={colors.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Lugares guardados</Text>
        <View style={styles.back} />
      </View>

      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={!isLoading && isRefreshing}
            onRefresh={refetch}
            tintColor={colors.primary}
            colors={[colors.primary]}
          />
        }>
        <Text style={styles.subtitle}>
          Administra tus destinos frecuentes para reservar más rápido.
        </Text>

        {areaError ? (
          <View style={styles.areaWarning} accessibilityLiveRegion="polite">
            <Ionicons name="location-outline" size={18} color={colors.danger} />
            <Text style={styles.areaWarningText}>{areaError}</Text>
          </View>
        ) : null}

        <TouchableOpacity
          style={styles.addButton}
          onPress={addNew}
          accessibilityRole="button"
          accessibilityLabel="Agregar nuevo lugar">
          <Ionicons name="add" size={22} color={colors.textOnPrimary} />
          <Text style={styles.addButtonText}>Agregar nuevo lugar</Text>
        </TouchableOpacity>

        {isLoading ? (
          <FeedbackState compact loading title="Cargando tus lugares…" />
        ) : isError && saved.length === 0 ? (
          <FeedbackState
            compact
            icon="cloud-offline-outline"
            title="No pudimos cargar tus lugares"
            message={getApiErrorMessage(error)}
            actionLabel="Reintentar"
            onAction={refetch}
          />
        ) : saved.length === 0 ? (
          <FeedbackState
            compact
            icon="bookmark-outline"
            title="Aún no tienes lugares guardados"
            message="Guarda tu casa, trabajo o cualquier destino frecuente."
          />
        ) : (
          <View style={styles.list}>
            {saved.map((item) => {
              const meta = CATEGORY_META[item.category];
              return (
                <View key={item.id} style={styles.row}>
                  <TouchableOpacity
                    style={styles.rowMain}
                    onPress={() => selectDestination(item.place)}
                    accessibilityRole="button"
                    accessibilityLabel={`Ir a ${item.label}`}>
                    <View style={styles.rowIcon}>
                      <Ionicons name={meta.icon} size={20} color={colors.primary} />
                    </View>
                    <View style={styles.rowText}>
                      <Text style={styles.rowTitle}>{item.label}</Text>
                      <Text style={styles.rowAddress} numberOfLines={1}>
                        {item.place.address}
                      </Text>
                    </View>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.editButton}
                    onPress={() => edit(item)}
                    hitSlop={8}
                    accessibilityRole="button"
                    accessibilityLabel={`Editar ${item.label}`}>
                    <View style={styles.editIcon}>
                      <Ionicons name="pencil" size={20} color={colors.primary} />
                    </View>
                  </TouchableOpacity>
                </View>
              );
            })}
          </View>
        )}

        {saveableRecents.length > 0 && (
          <View style={styles.recentBox}>
            <View style={styles.recentBoxHeader}>
              <Ionicons name="time-outline" size={18} color={colors.textSecondary} />
              <Text style={styles.recentBoxTitle}>¿Guardar un destino reciente?</Text>
            </View>
            <View style={styles.chips}>
              {saveableRecents.map((r) => (
                <TouchableOpacity
                  key={`${r.coordinates.latitude},${r.coordinates.longitude}`}
                  style={styles.chip}
                  onPress={() => quickSave(r)}
                  accessibilityRole="button"
                  accessibilityLabel={`Guardar ${r.name}`}>
                  <Ionicons name="add" size={16} color={colors.primary} />
                  <Text style={styles.chipText} numberOfLines={1}>
                    {r.name}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  back: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: fontSize.lg, fontWeight: fontWeight.semibold, color: colors.text },

  scroll: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xl },
  subtitle: { fontSize: fontSize.sm, color: colors.textSecondary, marginBottom: spacing.md },
  areaWarning: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.md,
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: '#FDECEA',
  },
  areaWarningText: { flex: 1, color: colors.danger, fontSize: fontSize.sm },

  addButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    height: 52,
    borderRadius: radius.md,
    backgroundColor: colors.primary,
    marginBottom: spacing.lg,
  },
  addButtonText: {
    color: colors.textOnPrimary,
    fontSize: fontSize.md,
    fontWeight: fontWeight.semibold,
  },

  list: { gap: spacing.sm },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  rowMain: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.md,
  },
  rowIcon: {
    width: 40,
    height: 40,
    borderRadius: radius.pill,
    backgroundColor: `${colors.primary}18`,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowText: { flex: 1 },
  rowTitle: { fontSize: fontSize.md, fontWeight: fontWeight.medium, color: colors.text },
  rowAddress: { fontSize: fontSize.sm, color: colors.textSecondary },
  editButton: {
    width: 52,
    height: 52,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.xs,
  },
  editIcon: {
    width: 40,
    height: 40,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceMuted,
    alignItems: 'center',
    justifyContent: 'center',
  },

  recentBox: {
    marginTop: spacing.lg,
    padding: spacing.md,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    borderStyle: 'dashed',
    gap: spacing.sm,
  },
  recentBoxHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  recentBoxTitle: { fontSize: fontSize.sm, color: colors.textSecondary },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    maxWidth: '100%',
    paddingHorizontal: spacing.md,
    height: 36,
    borderRadius: radius.pill,
    backgroundColor: `${colors.primary}11`,
  },
  chipText: { fontSize: fontSize.sm, color: colors.primary, fontWeight: fontWeight.medium },

});
