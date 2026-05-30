/**
 * Pantalla "¿A dónde vamos?" — primer paso tras fijar el origen.
 *
 * Muestra los destinos recientes (o un estado vacío si no hay) y un acceso
 * directo para seleccionar el destino en el mapa. La barra de búsqueda filtra
 * los recientes localmente; la búsqueda por geocoding queda para una entrega
 * posterior (ver plan).
 */
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
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
import { useRecentDestinations } from '@/features/booking/application/useRecentDestinations';
import type { Place } from '@/features/booking/domain/types';

export function DestinationSearchScreen() {
  const router = useRouter();
  const setDestination = useBookingStore((s) => s.setDestination);
  const { places, isLoading } = useRecentDestinations();
  const [query, setQuery] = useState('');

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return places;
    return places.filter(
      (p) => p.name.toLowerCase().includes(q) || p.address.toLowerCase().includes(q),
    );
  }, [query, places]);

  const selectPlace = (place: Place) => {
    setDestination(place);
    // `navigate` vuelve a la pantalla de configurar si ya está en la pila.
    router.navigate('/booking/configure');
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

      <Text style={styles.sectionTitle}>Destinos recientes</Text>

      {isLoading ? (
        <View style={styles.empty}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      ) : results.length === 0 ? (
        <EmptyState filtering={query.trim().length > 0} />
      ) : (
        <ScrollView contentContainerStyle={styles.list} keyboardShouldPersistTaps="handled">
          {results.map((place) => (
            <TouchableOpacity
              key={`${place.coordinates.latitude},${place.coordinates.longitude}`}
              style={styles.item}
              onPress={() => selectPlace(place)}
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
    </SafeAreaView>
  );
}

function EmptyState({ filtering }: { filtering: boolean }) {
  return (
    <View style={styles.empty}>
      <Ionicons name="location-outline" size={64} color={colors.border} />
      <Text style={styles.emptyTitle}>
        {filtering ? 'Sin coincidencias' : 'Aún no tienes destinos recientes'}
      </Text>
      <Text style={styles.emptySubtitle}>
        {filtering
          ? 'Prueba con otro nombre o selecciónalo en el mapa.'
          : 'Busca un lugar o selecciónalo en el mapa.'}
      </Text>
    </View>
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
