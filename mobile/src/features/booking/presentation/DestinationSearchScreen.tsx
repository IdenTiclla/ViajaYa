/**
 * Pantalla "¿A dónde vamos?" — primer paso tras fijar el origen.
 *
 * La barra de búsqueda autocompleta lugares con Google Places (sesgados hacia
 * el origen) en cuanto se escriben ≥ 3 caracteres. Sin término buscable se
 * muestran los destinos recientes; también hay un acceso directo para elegir el
 * destino en el mapa.
 */
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
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

import { colors, fontSize, fontWeight, radius, spacing } from '@/core/theme';
import { useBookingStore } from '@/features/booking/application/useBookingStore';
import { usePlaceSearch } from '@/features/booking/application/usePlaceSearch';
import { useRecentDestinations } from '@/features/booking/application/useRecentDestinations';
import type { Place, PlaceSuggestion } from '@/features/booking/domain/types';

export function DestinationSearchScreen() {
  const router = useRouter();
  const origin = useBookingStore((s) => s.origin);
  const setDestination = useBookingStore((s) => s.setDestination);
  const { places, isLoading } = useRecentDestinations();
  const [query, setQuery] = useState('');
  // placeId que se está resolviendo (coordenadas) tras tocar una sugerencia.
  const [resolvingId, setResolvingId] = useState<string | null>(null);

  const { suggestions, isLoading: isSearching, isActive, resolve } = usePlaceSearch(
    query,
    origin?.coordinates,
  );

  const goToConfigure = (place: Place) => {
    setDestination(place);
    // `navigate` vuelve a la pantalla de configurar si ya está en la pila.
    router.navigate('/booking/configure');
  };

  const selectSuggestion = async (suggestion: PlaceSuggestion) => {
    if (resolvingId) return;
    setResolvingId(suggestion.placeId);
    const place = await resolve(suggestion);
    setResolvingId(null);
    if (place) goToConfigure(place);
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
            onChangeText={setQuery}
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

      <TouchableOpacity
        style={styles.mapButton}
        onPress={() => router.push('/booking/pick-on-map')}
        accessibilityRole="button"
        accessibilityLabel="Seleccionar en el mapa">
        <Ionicons name="map" size={20} color={colors.textOnPrimary} />
        <Text style={styles.mapButtonText}>Seleccionar en el mapa</Text>
      </TouchableOpacity>

      {isActive ? (
        <SearchResults
          suggestions={suggestions}
          isLoading={isSearching}
          resolvingId={resolvingId}
          onSelect={selectSuggestion}
        />
      ) : (
        <RecentDestinations places={places} isLoading={isLoading} onSelect={goToConfigure} />
      )}
    </SafeAreaView>
  );
}

function SearchResults({
  suggestions,
  isLoading,
  resolvingId,
  onSelect,
}: {
  suggestions: PlaceSuggestion[];
  isLoading: boolean;
  resolvingId: string | null;
  onSelect: (suggestion: PlaceSuggestion) => void;
}) {
  if (suggestions.length === 0) {
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
        <View style={styles.empty}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      ) : places.length === 0 ? (
        <View style={styles.empty}>
          <Ionicons name="location-outline" size={64} color={colors.border} />
          <Text style={styles.emptyTitle}>Aún no tienes destinos recientes</Text>
          <Text style={styles.emptySubtitle}>Busca un lugar o selecciónalo en el mapa.</Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.list} keyboardShouldPersistTaps="handled">
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
        </ScrollView>
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

  mapButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    height: 52,
    marginHorizontal: spacing.lg,
    marginTop: spacing.sm,
    borderRadius: radius.md,
    backgroundColor: colors.primary,
  },
  mapButtonText: { color: colors.textOnPrimary, fontSize: fontSize.md, fontWeight: fontWeight.semibold },

  sectionTitle: {
    fontSize: fontSize.xs,
    fontWeight: fontWeight.semibold,
    color: colors.textSecondary,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    paddingHorizontal: spacing.lg,
    marginTop: spacing.lg,
    marginBottom: spacing.sm,
  },

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

  empty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
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
