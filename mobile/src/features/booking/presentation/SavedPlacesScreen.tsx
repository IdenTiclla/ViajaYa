/**
 * "Mis lugares guardados": lista los favoritos del pasajero (Casa, Trabajo,
 * Gimnasio, Otros). Permite agregar uno nuevo, editar cada uno, y tocar uno
 * para usarlo como destino del viaje. También ofrece guardar rápido un destino
 * reciente.
 */
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { colors, fontSize, fontWeight, radius, spacing } from '@/core/theme';
import { useBookingStore } from '@/features/booking/application/useBookingStore';
import { useRecentDestinations } from '@/features/booking/application/useRecentDestinations';
import { useSavedPlaces } from '@/features/booking/application/useSavedPlaces';
import type { Place, SavedPlace } from '@/features/booking/domain/types';
import { CATEGORY_META } from '@/features/booking/presentation/savedPlaceCategory';

export function SavedPlacesScreen() {
  const router = useRouter();
  const { places: saved, isLoading } = useSavedPlaces();
  const { places: recents } = useRecentDestinations();
  const setDestination = useBookingStore((s) => s.setDestination);

  const selectDestination = (place: Place) => {
    setDestination(place);
    router.navigate('/booking/configure');
  };

  const addNew = () => {
    router.push({ pathname: '/booking/pick-on-map', params: { saveAs: '1' } });
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
      },
    });
  };

  // Guarda rápido un destino reciente: ya tiene coordenadas, así que va directo
  // al formulario sin pasar por el mapa.
  const quickSave = (place: Place) => {
    router.push({
      pathname: '/booking/edit-place',
      params: {
        lat: String(place.coordinates.latitude),
        lng: String(place.coordinates.longitude),
        name: place.name,
        address: place.address,
        label: place.name,
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

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <Text style={styles.subtitle}>
          Administra tus destinos frecuentes para reservar más rápido.
        </Text>

        <TouchableOpacity
          style={styles.addButton}
          onPress={addNew}
          accessibilityRole="button"
          accessibilityLabel="Agregar nuevo lugar">
          <Ionicons name="add" size={22} color={colors.textOnPrimary} />
          <Text style={styles.addButtonText}>Agregar nuevo lugar</Text>
        </TouchableOpacity>

        {isLoading ? (
          <View style={styles.empty}>
            <ActivityIndicator size="large" color={colors.primary} />
          </View>
        ) : saved.length === 0 ? (
          <View style={styles.empty}>
            <Ionicons name="bookmark-outline" size={56} color={colors.border} />
            <Text style={styles.emptyTitle}>Aún no tienes lugares guardados</Text>
            <Text style={styles.emptySubtitle}>
              Guarda tu casa, trabajo o cualquier destino frecuente.
            </Text>
          </View>
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

  empty: { alignItems: 'center', justifyContent: 'center', paddingVertical: spacing.xxl, gap: spacing.sm },
  emptyTitle: {
    fontSize: fontSize.md,
    fontWeight: fontWeight.semibold,
    color: colors.text,
    textAlign: 'center',
  },
  emptySubtitle: {
    fontSize: fontSize.sm,
    color: colors.textSecondary,
    textAlign: 'center',
    paddingHorizontal: spacing.lg,
  },
});
