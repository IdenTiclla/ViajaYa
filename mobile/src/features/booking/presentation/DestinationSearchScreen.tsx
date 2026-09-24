/**
 * "¿A dónde vamos?" screen — first step after setting the origin.
 *
 * The search bar autocompletes places with Google Places (biased toward
 * the origin) as soon as ≥ 3 characters are typed. Without a searchable term it
 * shows the shortcuts to saved places (Casa/Trabajo + favorites), the entry
 * to set the location on the map, and the recent destinations.
 */
import { Ionicons } from '@react-native-vector-icons/ionicons';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { getApiErrorMessage } from '@/core/errors/apiError';
import { fontSize, fontWeight, radius, spacing, useThemedStyles, type Theme } from '@/core/theme';
import { useBookingStore } from '@/features/booking/application/useBookingStore';
import { usePlaceSearch } from '@/features/booking/application/usePlaceSearch';
import { useRecentDestinations } from '@/features/booking/application/useRecentDestinations';
import { findByCategory, useSavedPlaces } from '@/features/booking/application/useSavedPlaces';
import { useDestinationSelection } from '@/features/booking/application/useSeleccionDestino';
import type {
  Place,
  PlaceSuggestion,
  SavedPlace,
  SavedPlaceCategory,
} from '@/features/booking/domain/types';
import { CATEGORY_META } from '@/features/booking/presentation/savedPlaceCategory';
import { Button, FeedbackState } from '@/shared/components';

function placeErrorMessage(error: unknown): string {
  return error instanceof Error
    ? error.message
    : 'No pudimos buscar lugares. Revisa tu conexión e inténtalo de nuevo.';
}

export function DestinationSearchScreen() {
  const { colors, styles } = useThemedStyles(createStyles);
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { fontScale } = useWindowDimensions();
  const searchBar = useRef<TextInput>(null);
  const { rideId } = useLocalSearchParams<{ rideId?: string }>();
  const origin = useBookingStore((s) => s.origin);
  const setDestination = useBookingStore((s) => s.setDestination);
  const { places, isLoading, isError: recentsError, error: recentsLoadError, refetch: retryRecents } = useRecentDestinations();
  const {
    places: saved,
    isLoading: savedPlacesLoading,
    isError: savedPlacesError,
    error: savedPlacesErrorValue,
    refetch: refetchSavedPlaces,
  } = useSavedPlaces();
  const [query, setQuery] = useState('');
  const [searchFocused, setSearchFocused] = useState(false);

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
    Keyboard.dismiss();
    setDestination(place);
    // In edit mode it closes the auxiliary screens back to the original Configure;
    // when creating, dismissTo replaces the current screen if it does not exist yet.
    router.dismissTo({
      pathname: '/booking/configure',
      params: rideId ? { rideId } : {},
    });
  };

  const {
    resolvingId,
    selectionError,
    selectSuggestion,
    selectPlace,
    cancelSelection,
  } = useDestinationSelection(resolve, goToConfigure);

  // Also invalidates the selection when leaving with the system gesture or button.
  useFocusEffect(useCallback(() => () => cancelSelection(), [cancelSelection]));

  const openMap = () => {
    cancelSelection();
    Keyboard.dismiss();
    router.push({ pathname: '/booking/pick-on-map', params: rideId ? { rideId } : {} });
  };

  const changeSearch = (text: string) => {
    cancelSelection();
    setQuery(text);
  };

  // Casa/Trabajo shortcut: if it is already saved, use it as the destination; if not, open
  // the flow to set it (map → name/save) with the category preset.
  const onShortcut = (category: SavedPlaceCategory) => {
    if (savedPlacesError || savedPlacesLoading) return;
    cancelSelection();
    const existing = findByCategory(saved, category);
    if (existing) {
      selectPlace(existing.place);
    } else {
      router.push({
        pathname: '/booking/pick-on-map',
        params: { saveAs: '1', category, ...(rideId ? { rideId } : {}) },
      });
    }
  };

  return (
    <SafeAreaView style={styles.root} edges={['top']}>
      <KeyboardAvoidingView style={styles.root} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <View style={styles.header}>
          <TouchableOpacity
            style={styles.back}
            onPress={() => { cancelSelection(); router.back(); }}
            accessibilityRole="button"
            accessibilityLabel="Volver">
            <Ionicons name="arrow-back" size={24} color={colors.text} />
          </TouchableOpacity>
          <View style={[styles.searchBar, searchFocused && styles.searchBarFocused]}>
            <Ionicons name="search" size={20} color={colors.placeholder} />
            <TextInput
              ref={searchBar}
              style={styles.searchInput}
              placeholder="Buscar destino"
              placeholderTextColor={colors.placeholder}
              value={query}
              onChangeText={changeSearch}
              onFocus={() => setSearchFocused(true)}
              onBlur={() => setSearchFocused(false)}
              accessibilityLabel="Buscar destino"
              accessibilityHint="Escribe al menos 3 caracteres para buscar lugares."
              autoCorrect={false}
              autoFocus
              returnKeyType="search"
            />
            {query.length > 0 && (
              <TouchableOpacity
                style={styles.clearSearch}
                onPress={() => { changeSearch(''); searchBar.current?.focus(); }}
                accessibilityRole="button"
                accessibilityLabel="Borrar búsqueda">
                <Ionicons name="close-circle" size={20} color={colors.placeholder} />
              </TouchableOpacity>
            )}
          </View>
        </View>

        <Text style={styles.searchHint} accessibilityLiveRegion="polite">
          {resolvingId ? 'Obteniendo la ubicación elegida…' : query.trim().length > 0 && !isActive
            ? 'Escribe al menos 3 caracteres para buscar.' : 'Busca una calle, un lugar o elige un punto en el mapa.'}
        </Text>

        {isActive && (
          <View style={styles.mapAction}>
            <Button title="Elegir en el mapa" variant="secondary" leadingIcon="map-outline" onPress={openMap} />
          </View>
        )}

        {isActive ? (
          <SearchResults
            suggestions={suggestions}
            isLoading={isSearching}
            error={searchError ? placeErrorMessage(error) : null}
            selectionError={selectionError}
            onRetry={retry}
            resolvingId={resolvingId}
            onSelect={selectSuggestion}
            bottomInset={insets.bottom}
          />
        ) : (
          <ScrollView
            contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + spacing.lg }]}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
            showsVerticalScrollIndicator={false}>
            {selectionError ? (
              <View style={styles.selectionError} accessibilityLiveRegion="polite">
                <Ionicons name="location-outline" size={18} color={colors.danger} />
                <Text style={styles.selectionErrorText}>{selectionError}</Text>
              </View>
            ) : null}
            <TouchableOpacity
              style={[styles.wideCard, fontScale > 1.3 && styles.wideCardColumn]}
              onPress={openMap}
              accessibilityRole="button"
              accessibilityLabel="Seleccionar en el mapa, fija la ubicación manualmente">
              <View style={[styles.cardIcon, styles.mapIcon]}>
                <Ionicons name="map" size={20} color={colors.textOnPrimary} />
              </View>
              <View style={[styles.itemText, fontScale > 1.3 && styles.wideCardTextColumn]}>
                <Text style={styles.cardTitle}>Seleccionar en el mapa</Text>
                <Text style={styles.cardSubtitle}>Fija la ubicación manualmente</Text>
              </View>
              {fontScale <= 1.3 && <Ionicons name="chevron-forward" size={20} color={colors.placeholder} />}
            </TouchableOpacity>

            {savedPlacesError && (
              <TouchableOpacity
                style={styles.savedWarning}
                onPress={refetchSavedPlaces}
                accessibilityRole="button"
                accessibilityLabel="Reintentar lugares guardados">
                <Ionicons name="cloud-offline-outline" size={18} color={colors.danger} />
                <Text style={styles.savedWarningText}>
                  {getApiErrorMessage(savedPlacesErrorValue)}
                </Text>
                <Ionicons name="refresh" size={18} color={colors.primary} />
              </TouchableOpacity>
            )}

            <View style={[styles.bento, fontScale > 1.3 && styles.bentoColumn]}>
              <ShortcutCard
                category="home"
                place={findByCategory(saved, 'home')}
                disabled={savedPlacesError || savedPlacesLoading}
                loading={savedPlacesLoading}
                inColumn={fontScale > 1.3}
                onPress={() => onShortcut('home')}
              />
              <ShortcutCard
                category="work"
                place={findByCategory(saved, 'work')}
                disabled={savedPlacesError || savedPlacesLoading}
                loading={savedPlacesLoading}
                inColumn={fontScale > 1.3}
                onPress={() => onShortcut('work')}
              />
            </View>

            <TouchableOpacity
              style={[styles.wideCard, fontScale > 1.3 && styles.wideCardColumn]}
              onPress={() => {
                cancelSelection();
                router.push({
                  pathname: '/booking/saved-places',
                  params: rideId ? { rideId } : {},
                });
              }}
              accessibilityRole="button"
              accessibilityLabel="Ver lugares guardados">
              <View style={[styles.cardIcon, styles.savedIcon]}>
                <Ionicons name="bookmark" size={20} color={colors.primary} />
              </View>
              <View style={[styles.itemText, fontScale > 1.3 && styles.wideCardTextColumn]}>
                <Text style={styles.cardTitle}>Lugares guardados</Text>
                <Text style={styles.cardSubtitle}>
                  {saved.length > 0
                    ? `${saved.length} ${saved.length === 1 ? 'lugar guardado' : 'lugares guardados'}`
                    : 'Guarda tus destinos frecuentes'}
                </Text>
              </View>
              {fontScale <= 1.3 && <Ionicons name="chevron-forward" size={20} color={colors.placeholder} />}
            </TouchableOpacity>

            <RecentDestinations places={places} isLoading={isLoading} error={recentsError ? getApiErrorMessage(recentsLoadError) : null} onRetry={retryRecents} onSelect={selectPlace} />
          </ScrollView>
        )}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function ShortcutCard({
  category,
  place,
  disabled,
  loading,
  inColumn,
  onPress,
}: {
  category: Extract<SavedPlaceCategory, 'home' | 'work'>;
  place: SavedPlace | undefined;
  disabled: boolean;
  loading: boolean;
  inColumn: boolean;
  onPress: () => void;
}) {
  const { colors, styles } = useThemedStyles(createStyles);
  const meta = CATEGORY_META[category];
  const tint = colors.primary;
  return (
    <TouchableOpacity
      style={[styles.bentoCard, !inColumn && styles.shortcutRow, disabled && styles.disabled]}
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityState={{ disabled, busy: loading }}
      aria-busy={loading}
      accessibilityLabel={place ? `Ir a ${place.label}` : `Fijar ${meta.label.toLowerCase()}`}>
      <View style={[styles.cardIcon, { backgroundColor: `${tint}22` }]}>
        <Ionicons name={meta.icon} size={20} color={tint} />
      </View>
      <Text style={styles.cardTitle}>{place?.label ?? meta.label}</Text>
      <Text style={styles.cardSubtitle}>
        {loading ? 'Cargando…' : place?.place.address ?? `Fijar ${meta.label.toLowerCase()}`}
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
  bottomInset,
}: {
  suggestions: PlaceSuggestion[];
  isLoading: boolean;
  error: string | null;
  selectionError: string | null;
  onRetry: () => void;
  resolvingId: string | null;
  onSelect: (suggestion: PlaceSuggestion) => void;
  bottomInset: number;
}) {
  const { colors, styles } = useThemedStyles(createStyles);
  if (suggestions.length === 0) {
    return (
      <ScrollView contentContainerStyle={[styles.feedbackScroll, { paddingBottom: bottomInset + spacing.lg }]} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">
        {error ? (
          <FeedbackState
            compact
            icon="cloud-offline-outline"
            title="No pudimos buscar lugares"
            message={error}
            actionLabel="Reintentar"
            onAction={onRetry}
          />
        ) : (
          <FeedbackState
            compact
            loading={isLoading}
            icon="search-outline"
            title={isLoading ? 'Buscando lugares…' : 'No encontramos ese lugar'}
            message={isLoading ? undefined : 'Prueba con el nombre de la calle y la ciudad, o usa «Elegir en el mapa».'}
          />
        )}
      </ScrollView>
    );
  }

  return (
    <ScrollView contentContainerStyle={[styles.list, { paddingBottom: bottomInset + spacing.lg }]} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">
      <Text style={styles.sectionTitle} accessibilityLiveRegion="polite">
        {suggestions.length} {suggestions.length === 1 ? 'lugar encontrado' : 'lugares encontrados'}
      </Text>
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
            accessibilityState={{ disabled: Boolean(resolvingId), busy: isResolving }}
            aria-busy={isResolving}
            accessibilityLabel={`Ir a ${suggestion.name}${suggestion.address ? `, ${suggestion.address}` : ''}`}>
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
  error,
  onRetry,
}: {
  places: Place[];
  isLoading: boolean;
  onSelect: (place: Place) => void;
  error: string | null;
  onRetry: () => void;
}) {
  const { colors, styles } = useThemedStyles(createStyles);
  return (
    <>
      <Text style={styles.sectionTitle}>Destinos recientes</Text>

      {error && (
        <View style={styles.recentError}>
          <Text style={styles.recentErrorText} accessibilityRole="alert">No pudimos actualizar tus destinos recientes. {error}</Text>
          <Button title="Reintentar recientes" variant="secondary" onPress={onRetry} />
        </View>
      )}

      {isLoading ? (
        <View style={styles.emptyInline}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      ) : places.length === 0 && !error ? (
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
              accessibilityLabel={`Ir a ${place.name}, ${place.address}`}>
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

const createStyles = ({ colors, focusStyle }: Theme) => StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  back: {
    width: 48,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  searchBar: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: 48,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.controlBorder,
    backgroundColor: colors.surfaceMuted,
  },
  searchInput: { flex: 1, minWidth: 0, fontSize: fontSize.md, color: colors.text, paddingVertical: spacing.sm, outlineWidth: 0 },
  searchBarFocused: { borderColor: colors.primary, backgroundColor: colors.surface, ...focusStyle },
  clearSearch: { width: 48, minHeight: 48, alignItems: 'center', justifyContent: 'center' },
  searchHint: { paddingHorizontal: spacing.lg, paddingBottom: spacing.sm, fontSize: fontSize.sm, color: colors.textSecondary },
  mapAction: { paddingHorizontal: spacing.lg, paddingBottom: spacing.md },

  scroll: { paddingHorizontal: spacing.lg, paddingTop: spacing.sm, paddingBottom: spacing.xl },

  bento: { flexDirection: 'row', gap: spacing.md, marginBottom: spacing.md },
  bentoColumn: { flexDirection: 'column' },
  shortcutRow: { flex: 1 },
  bentoCard: {
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
  wideCardColumn: { flexDirection: 'column', alignItems: 'flex-start', gap: spacing.sm },
  wideCardTextColumn: { flex: 0, width: '100%' },
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
    minHeight: 48,
    paddingVertical: spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    marginBottom: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.dangerSoft,
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
  feedbackScroll: { flexGrow: 1, justifyContent: 'center' },
  item: { minHeight: 56, paddingVertical: spacing.sm, flexDirection: 'row', alignItems: 'center', gap: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.border },
  itemIcon: {
    width: 40,
    height: 40,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceMuted,
    alignItems: 'center',
    justifyContent: 'center',
  },
  itemText: { flex: 1, minWidth: 0 },
  itemName: { fontSize: fontSize.md, fontWeight: fontWeight.medium, color: colors.text },
  itemAddress: { fontSize: fontSize.sm, color: colors.textSecondary },
  selectionError: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.dangerSoft,
  },
  selectionErrorText: { flex: 1, color: colors.danger, fontSize: fontSize.sm },
  recentError: { gap: spacing.sm, marginBottom: spacing.md },
  recentErrorText: { color: colors.danger, fontSize: fontSize.sm },
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
