/**
 * Pantalla "¿A dónde vamos?" — primer paso tras fijar el origen.
 *
 * La barra de búsqueda autocompleta lugares con Google Places (sesgados hacia
 * el origen) en cuanto se escriben ≥ 3 caracteres. Sin término buscable se
 * muestran los atajos a lugares guardados (Casa/Trabajo + favoritos), el acceso
 * para fijar la ubicación en el mapa y los destinos recientes.
 */
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { getApiErrorMessage } from '@/core/errors/apiError';
import { colors, fontSize, fontWeight, radius, spacing } from '@/core/theme';
import { useBookingStore } from '@/features/booking/application/useBookingStore';
import { usePlaceSearch } from '@/features/booking/application/usePlaceSearch';
import { useRecentDestinations } from '@/features/booking/application/useRecentDestinations';
import { findByCategory, useSavedPlaces } from '@/features/booking/application/useSavedPlaces';
import { getBoliviaPlaceError } from '@/features/booking/domain/bolivia';
import type {
  Place,
  PlaceSuggestion,
  SavedPlace,
  SavedPlaceCategory,
} from '@/features/booking/domain/types';
import { CATEGORY_META } from '@/features/booking/presentation/savedPlaceCategory';
import { FeedbackState } from '@/shared/components';

function placeErrorMessage(error: unknown): string {
  return error instanceof Error
    ? error.message
    : 'No pudimos buscar lugares. Revisa tu conexión e inténtalo de nuevo.';
}

export function DestinationSearchScreen() {
  const router = useRouter();
  const { rideId } = useLocalSearchParams<{ rideId?: string }>();
  const origin = useBookingStore((s) => s.origin);
  const setDestination = useBookingStore((s) => s.setDestination);
  const { places, isLoading } = useRecentDestinations();
  const {
    places: saved,
    isError: savedPlacesError,
    error: savedPlacesErrorValue,
    refetch: refetchSavedPlaces,
  } = useSavedPlaces();
  const [query, setQuery] = useState('');
  // placeId que se está resolviendo (coordenadas) tras tocar una sugerencia.
  const [resolvingId, setResolvingId] = useState<string | null>(null);
  const [selectionError, setSelectionError] = useState<string | null>(null);

  const {
    suggestions,
    isLoading: isSearching,
    isError: searchError,
    error,
    isActive,
    retry,
    resolve,
  } = usePlaceSearch(query, origin?.coordinates);

  const goToConfigure = (place: Place) => {
    const areaError = getBoliviaPlaceError(place);
    if (areaError) {
      setSelectionError(areaError);
      return;
    }
    setSelectionError(null);
    setDestination(place);
    // En edición cierra las pantallas auxiliares hacia el Configure original;
    // en creación, dismissTo reemplaza la pantalla actual si aún no existe.
    router.dismissTo({
      pathname: '/booking/configure',
      params: rideId ? { rideId } : {},
    });
  };

  const selectSuggestion = async (suggestion: PlaceSuggestion) => {
    if (resolvingId) return;
    setSelectionError(null);
    setResolvingId(suggestion.placeId);
    try {
      const place = await resolve(suggestion);
      if (place) goToConfigure(place);
    } catch (resolveError) {
      setSelectionError(placeErrorMessage(resolveError));
    } finally {
      setResolvingId(null);
    }
  };

  // Atajo Casa/Trabajo: si ya está guardado, lo usa como destino; si no, abre
  // el flujo para fijarlo (mapa → nombrar/guardar) con la categoría puesta.
  const onShortcut = (category: SavedPlaceCategory) => {
    if (savedPlacesError) return;
    const existing = findByCategory(saved, category);
    if (existing) {
      goToConfigure(existing.place);
    } else {
      router.push({
        pathname: '/booking/pick-on-map',
        params: { saveAs: '1', category, ...(rideId ? { rideId } : {}) },
      });
    }
  };

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
        <View style={styles.searchBar}>
          <Ionicons name="search" size={20} color={colors.placeholder} />
          <TextInput
            style={styles.searchInput}
            placeholder="Buscar destino"
            placeholderTextColor={colors.placeholder}
            value={query}
            onChangeText={(value) => {
              setQuery(value);
              setSelectionError(null);
            }}
            autoFocus
            returnKeyType="search"
          />
          {query.length > 0 && (
            <TouchableOpacity
              onPress={() => setQuery('')}
              accessibilityRole="button"
              accessibilityLabel="Borrar búsqueda">
              <Ionicons name="close-circle" size={20} color={colors.placeholder} />
            </TouchableOpacity>
          )}
        </View>
      </View>

      {isActive ? (
        <SearchResults
          suggestions={suggestions}
          isLoading={isSearching}
          error={searchError ? placeErrorMessage(error) : null}
          selectionError={selectionError}
          onRetry={retry}
          resolvingId={resolvingId}
          onSelect={selectSuggestion}
        />
      ) : (
        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}>
          {selectionError ? (
            <View style={styles.selectionError} accessibilityLiveRegion="polite">
              <Ionicons name="location-outline" size={18} color={colors.danger} />
              <Text style={styles.selectionErrorText}>{selectionError}</Text>
            </View>
          ) : null}
          <TouchableOpacity
            style={styles.wideCard}
            onPress={() =>
              router.push({
                pathname: '/booking/pick-on-map',
                params: rideId ? { rideId } : {},
              })
            }
            accessibilityRole="button"
            accessibilityLabel="Seleccionar en el mapa, fija la ubicación manualmente">
            <View style={[styles.cardIcon, styles.mapIcon]}>
              <Ionicons name="map" size={20} color={colors.textOnPrimary} />
            </View>
            <View style={styles.itemText}>
              <Text style={styles.cardTitle}>Seleccionar en el mapa</Text>
              <Text style={styles.cardSubtitle}>Fija la ubicación manualmente</Text>
            </View>
            <Ionicons name="chevron-forward" size={20} color={colors.placeholder} />
          </TouchableOpacity>

          {savedPlacesError && (
            <TouchableOpacity
              style={styles.savedWarning}
              onPress={refetchSavedPlaces}
              accessibilityRole="button"
              accessibilityLabel="Reintentar lugares guardados">
              <Ionicons name="cloud-offline-outline" size={18} color={colors.danger} />
              <Text style={styles.savedWarningText} numberOfLines={2}>
                {getApiErrorMessage(savedPlacesErrorValue)}
              </Text>
              <Ionicons name="refresh" size={18} color={colors.primary} />
            </TouchableOpacity>
          )}

          <View style={styles.bento}>
            <ShortcutCard
              category="home"
              place={findByCategory(saved, 'home')}
              disabled={savedPlacesError}
              onPress={() => onShortcut('home')}
            />
            <ShortcutCard
              category="work"
              place={findByCategory(saved, 'work')}
              disabled={savedPlacesError}
              onPress={() => onShortcut('work')}
            />
          </View>

          <TouchableOpacity
            style={styles.wideCard}
            onPress={() =>
              router.push({
                pathname: '/booking/saved-places',
                params: rideId ? { rideId } : {},
              })
            }
            accessibilityRole="button"
            accessibilityLabel="Ver lugares guardados">
            <View style={[styles.cardIcon, styles.savedIcon]}>
              <Ionicons name="bookmark" size={20} color={colors.primary} />
            </View>
            <View style={styles.itemText}>
              <Text style={styles.cardTitle}>Lugares guardados</Text>
              <Text style={styles.cardSubtitle}>
                {saved.length > 0
                  ? `${saved.length} ${saved.length === 1 ? 'lugar guardado' : 'lugares guardados'}`
                  : 'Guarda tus destinos frecuentes'}
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={20} color={colors.placeholder} />
          </TouchableOpacity>

          <RecentDestinations places={places} isLoading={isLoading} onSelect={goToConfigure} />
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

function ShortcutCard({
  category,
  place,
  disabled,
  onPress,
}: {
  category: Extract<SavedPlaceCategory, 'home' | 'work'>;
  place: SavedPlace | undefined;
  disabled: boolean;
  onPress: () => void;
}) {
  const meta = CATEGORY_META[category];
  const tint = category === 'work' ? colors.accent : colors.primary;
  return (
    <TouchableOpacity
      style={[styles.bentoCard, disabled && styles.disabled]}
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      accessibilityLabel={place ? `Ir a ${place.label}` : `Fijar ${meta.label.toLowerCase()}`}>
      <View style={[styles.cardIcon, { backgroundColor: `${tint}22` }]}>
        <Ionicons name={meta.icon} size={20} color={tint} />
      </View>
      <Text style={styles.cardTitle}>{place?.label ?? meta.label}</Text>
      <Text style={styles.cardSubtitle} numberOfLines={1}>
        {place?.place.address ?? `Fijar ${meta.label.toLowerCase()}`}
      </Text>
    </TouchableOpacity>
  );
}

function SearchResults({
  suggestions,
  isLoading,
  error,
  selectionError,
  onRetry,
  resolvingId,
  onSelect,
}: {
  suggestions: PlaceSuggestion[];
  isLoading: boolean;
  error: string | null;
  selectionError: string | null;
  onRetry: () => void;
  resolvingId: string | null;
  onSelect: (suggestion: PlaceSuggestion) => void;
}) {
  if (suggestions.length === 0) {
    if (error) {
      return (
        <FeedbackState
          icon="cloud-offline-outline"
          title="No pudimos buscar lugares"
          message={error}
          actionLabel="Reintentar"
          onAction={onRetry}
        />
      );
    }
    return (
      <View style={styles.empty}>
        {isLoading ? (
          <ActivityIndicator size="large" color={colors.primary} />
        ) : (
          <>
            <Ionicons name="search-outline" size={64} color={colors.border} />
            <Text style={styles.emptyTitle}>Sin resultados</Text>
            <Text style={styles.emptySubtitle}>
              Prueba con otro nombre o selecciona el destino en el mapa.
            </Text>
          </>
        )}
      </View>
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.list} keyboardShouldPersistTaps="handled">
      {selectionError ? (
        <View style={styles.selectionError} accessibilityLiveRegion="polite">
          <Ionicons name="alert-circle-outline" size={18} color={colors.danger} />
          <Text style={styles.selectionErrorText}>{selectionError}</Text>
        </View>
      ) : null}
      {suggestions.map((suggestion) => {
        const isResolving = resolvingId === suggestion.placeId;
        return (
          <TouchableOpacity
            key={suggestion.placeId}
            style={styles.item}
            onPress={() => onSelect(suggestion)}
            disabled={Boolean(resolvingId)}
            accessibilityRole="button"
            accessibilityLabel={`Ir a ${suggestion.name}`}>
            <View style={styles.itemIcon}>
              {isResolving ? (
                <ActivityIndicator size="small" color={colors.textSecondary} />
              ) : (
                <Ionicons name="location-outline" size={20} color={colors.textSecondary} />
              )}
            </View>
            <View style={styles.itemText}>
              <Text style={styles.itemName}>{suggestion.name}</Text>
              {suggestion.address.length > 0 && (
                <Text style={styles.itemAddress}>{suggestion.address}</Text>
              )}
            </View>
          </TouchableOpacity>
        );
      })}
    </ScrollView>
  );
}

function RecentDestinations({
  places,
  isLoading,
  onSelect,
}: {
  places: Place[];
  isLoading: boolean;
  onSelect: (place: Place) => void;
}) {
  return (
    <>
      <Text style={styles.sectionTitle}>Destinos recientes</Text>

      {isLoading ? (
        <View style={styles.emptyInline}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      ) : places.length === 0 ? (
        <View style={styles.emptyInline}>
          <Ionicons name="location-outline" size={48} color={colors.border} />
          <Text style={styles.emptyTitle}>Aún no tienes destinos recientes</Text>
          <Text style={styles.emptySubtitle}>Busca un lugar o selecciónalo en el mapa.</Text>
        </View>
      ) : (
        <View style={styles.recentList}>
          {places.map((place) => (
            <TouchableOpacity
              key={`${place.coordinates.latitude},${place.coordinates.longitude}`}
              style={styles.item}
              onPress={() => onSelect(place)}
              accessibilityRole="button"
              accessibilityLabel={`Ir a ${place.name}`}>
              <View style={styles.itemIcon}>
                <Ionicons name="time-outline" size={20} color={colors.textSecondary} />
              </View>
              <View style={styles.itemText}>
                <Text style={styles.itemName}>{place.name}</Text>
                <Text style={styles.itemAddress}>{place.address}</Text>
              </View>
            </TouchableOpacity>
          ))}
        </View>
      )}
    </>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  back: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  searchBar: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    height: 48,
    paddingHorizontal: spacing.md,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceMuted,
  },
  searchInput: { flex: 1, fontSize: fontSize.md, color: colors.text, padding: 0 },

  scroll: { paddingHorizontal: spacing.lg, paddingTop: spacing.sm, paddingBottom: spacing.xl },

  bento: { flexDirection: 'row', gap: spacing.md, marginBottom: spacing.md },
  bentoCard: {
    flex: 1,
    padding: spacing.md,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    gap: spacing.xs,
  },

  wideCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: spacing.md,
  },
  cardIcon: {
    width: 40,
    height: 40,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  savedIcon: { backgroundColor: `${colors.primary}22` },
  mapIcon: { backgroundColor: colors.primary },
  cardTitle: { fontSize: fontSize.md, fontWeight: fontWeight.semibold, color: colors.text },
  cardSubtitle: { fontSize: fontSize.sm, color: colors.textSecondary },
  savedWarning: {
    minHeight: 46,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    marginBottom: spacing.md,
    borderRadius: radius.md,
    backgroundColor: '#FDECEA',
  },
  savedWarningText: { flex: 1, color: colors.danger, fontSize: fontSize.sm },
  disabled: { opacity: 0.5 },

  sectionTitle: {
    fontSize: fontSize.xs,
    fontWeight: fontWeight.semibold,
    color: colors.textSecondary,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    marginTop: spacing.sm,
    marginBottom: spacing.sm,
  },

  recentList: { gap: spacing.md },
  list: { paddingHorizontal: spacing.lg, gap: spacing.md, paddingBottom: spacing.xl },
  item: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  itemIcon: {
    width: 40,
    height: 40,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceMuted,
    alignItems: 'center',
    justifyContent: 'center',
  },
  itemText: { flex: 1 },
  itemName: { fontSize: fontSize.md, fontWeight: fontWeight.medium, color: colors.text },
  itemAddress: { fontSize: fontSize.sm, color: colors.textSecondary },
  selectionError: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: '#FDECEA',
  },
  selectionErrorText: { flex: 1, color: colors.danger, fontSize: fontSize.sm },

  empty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
    gap: spacing.sm,
  },
  emptyInline: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.xl,
    gap: spacing.sm,
  },
  emptyTitle: {
    fontSize: fontSize.md,
    fontWeight: fontWeight.semibold,
    color: colors.text,
    textAlign: 'center',
  },
  emptySubtitle: { fontSize: fontSize.sm, color: colors.textSecondary, textAlign: 'center' },
});
