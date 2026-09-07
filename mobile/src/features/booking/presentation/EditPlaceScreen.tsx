/**
 * Formulario para crear o editar un lugar guardado.
 *
 * Recibe por parámetros el punto ya elegido (lat/lng/name/address, fijado en el
 * mapa) más, en modo edición, `id`/`label`/`category`. El usuario pone un nombre
 * y una categoría; al guardar se persiste en el backend (`/saved-places`).
 */
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import {
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import MapView, { Marker, PROVIDER_GOOGLE } from 'react-native-maps';
import { SafeAreaView } from 'react-native-safe-area-context';

import { fontSize, fontWeight, radius, spacing, useEstilos, type Tema } from '@/core/theme';
import { useEstiloMapa } from '@/features/booking/presentation/mapStyle';
import { useDeletePlace, useSavePlace } from '@/features/booking/application/useSavedPlaces';
import { getBoliviaPlaceError } from '@/features/booking/domain/bolivia';
import { Button, ConfirmDialog } from '@/shared/components';
import type { Place, SavedPlaceCategory } from '@/features/booking/domain/types';
import {
  CATEGORY_META,
  CATEGORY_ORDER,
} from '@/features/booking/presentation/savedPlaceCategory';

function isCategory(value: string | undefined): value is SavedPlaceCategory {
  return value === 'home' || value === 'work' || value === 'gym' || value === 'other';
}

export function EditPlaceScreen() {
  const { colors, styles } = useEstilos(crearEstilos);
  const { estiloMapa, modoMapa } = useEstiloMapa(false);
  const router = useRouter();
  const params = useLocalSearchParams<{
    id?: string;
    lat?: string;
    lng?: string;
    name?: string;
    address?: string;
    label?: string;
    category?: string;
    countryCode?: string;
    rideId?: string;
  }>();

  const isEditing = Boolean(params.id);
  const latitude = Number(params.lat);
  const longitude = Number(params.lng);
  const hasPoint = Number.isFinite(latitude) && Number.isFinite(longitude);

  const initialCategory: SavedPlaceCategory = isCategory(params.category)
    ? params.category
    : 'other';
  const [category, setCategory] = useState<SavedPlaceCategory>(initialCategory);
  const [name, setName] = useState(
    params.label ?? (isCategory(params.category) ? CATEGORY_META[params.category].label : ''),
  );

  const savePlace = useSavePlace();
  const deletePlace = useDeletePlace();
  const busy = savePlace.isPending || deletePlace.isPending;
  const [confirmVisible, setConfirmVisible] = useState(false);

  const place: Place = {
    coordinates: { latitude, longitude },
    name: params.name ?? '',
    address: params.address ?? '',
    countryCode: params.countryCode?.toUpperCase() ?? null,
  };

  const onSave = () => {
    const label = name.trim();
    if (!label || !hasPoint || busy) return;
    const locationError = getBoliviaPlaceError(place);
    if (locationError) {
      Alert.alert('Ubicación fuera de cobertura', locationError);
      return;
    }
    savePlace.mutate(
      { id: params.id, input: { label, category, place } },
      {
        onSuccess: () => router.back(),
        onError: () =>
          Alert.alert('No se pudo guardar', 'Revisa tu conexión e inténtalo de nuevo.'),
      },
    );
  };

  const performDelete = () => {
    const id = params.id;
    if (!id) return;
    setConfirmVisible(false);
    deletePlace.mutate(id, {
      onSuccess: () => router.back(),
      onError: () =>
        Alert.alert('No se pudo eliminar', 'Revisa tu conexión e inténtalo de nuevo.'),
    });
  };

  // Reabre el mapa para cambiar el punto, conservando nombre/categoría actuales.
  const onChangeLocation = () => {
    router.replace({
      pathname: '/booking/pick-on-map',
      params: {
        saveAs: '1',
        category,
        ...(params.rideId ? { rideId: params.rideId } : {}),
        ...(params.id ? { id: params.id } : {}),
        ...(name.trim() ? { label: name.trim() } : {}),
      },
    });
  };

  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.back}
          onPress={() => router.back()}
          accessibilityRole="button"
          accessibilityLabel="Volver">
          <Ionicons name="arrow-back" size={24} color={colors.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{isEditing ? 'Editar lugar' : 'Guardar lugar'}</Text>
        <View style={styles.back} />
      </View>

      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        {hasPoint && (
          <View style={styles.mapPreview}>
            <MapView
              customMapStyle={estiloMapa}
              userInterfaceStyle={modoMapa}
              provider={PROVIDER_GOOGLE}
              style={StyleSheet.absoluteFill}
              region={{ latitude, longitude, latitudeDelta: 0.005, longitudeDelta: 0.005 }}
              scrollEnabled={false}
              zoomEnabled={false}
              rotateEnabled={false}
              pitchEnabled={false}
              pointerEvents="none">
              <Marker coordinate={{ latitude, longitude }} pinColor={colors.primary} />
            </MapView>
          </View>
        )}

        <Text style={styles.fieldLabel}>Nombre del lugar</Text>
        <View style={styles.inputRow}>
          <Ionicons name="pencil" size={18} color={colors.placeholder} />
          <TextInput
            style={styles.input}
            placeholder="Ej. Casa, Oficina, Gimnasio"
            placeholderTextColor={colors.placeholder}
            value={name}
            onChangeText={setName}
            returnKeyType="done"
          />
        </View>

        <Text style={styles.fieldLabel}>Dirección</Text>
        <TouchableOpacity
          style={styles.inputRow}
          onPress={onChangeLocation}
          accessibilityRole="button"
          accessibilityLabel="Cambiar ubicación en el mapa">
          <Ionicons name="location" size={18} color={colors.primary} />
          <Text style={styles.addressText} numberOfLines={2}>
            {place.address || 'Toca para elegir en el mapa'}
          </Text>
          <Ionicons name="chevron-forward" size={18} color={colors.placeholder} />
        </TouchableOpacity>

        <Text style={styles.fieldLabel}>Categoría</Text>
        <View style={styles.categoryGrid}>
          {CATEGORY_ORDER.map((cat) => {
            const meta = CATEGORY_META[cat];
            const selected = cat === category;
            return (
              <TouchableOpacity
                key={cat}
                style={[styles.categoryChip, selected && styles.categoryChipSelected]}
                onPress={() => setCategory(cat)}
                accessibilityRole="button"
                accessibilityState={{ selected }}
                accessibilityLabel={meta.label}>
                <Ionicons
                  name={meta.icon}
                  size={20}
                  color={selected ? colors.primary : colors.textSecondary}
                />
                <Text style={[styles.categoryText, selected && styles.categoryTextSelected]}>
                  {meta.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </ScrollView>

      <View style={styles.footer}>
        <Button
          title={isEditing ? 'Guardar cambios' : 'Guardar lugar'}
          leadingIcon="bookmark-outline"
          loading={savePlace.isPending}
          loadingLabel="Guardando lugar…"
          onPress={onSave}
          disabled={!name.trim() || !hasPoint || busy}
        />

        {isEditing && (
          <Button
            title="Eliminar lugar"
            leadingIcon="trash-outline"
            variant="dangerSoft"
            loading={deletePlace.isPending}
            loadingLabel="Eliminando lugar…"
            onPress={() => setConfirmVisible(true)}
            disabled={busy}
          />
        )}
      </View>

      <ConfirmDialog
        visible={confirmVisible}
        icon="trash-outline"
        destructive
        title="Eliminar lugar"
        message={`¿Seguro que quieres eliminar "${name.trim() || 'este lugar'}"? Esta acción no se puede deshacer.`}
        confirmText="Eliminar"
        cancelText="Cancelar"
        onConfirm={performDelete}
        onCancel={() => setConfirmVisible(false)}
      />
    </SafeAreaView>
  );
}

const crearEstilos = ({ colors }: Tema) => StyleSheet.create({
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

  scroll: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xl, gap: spacing.xs },

  mapPreview: {
    height: 140,
    borderRadius: radius.lg,
    overflow: 'hidden',
    marginBottom: spacing.md,
    backgroundColor: colors.surfaceMuted,
  },

  fieldLabel: {
    fontSize: fontSize.xs,
    fontWeight: fontWeight.semibold,
    color: colors.textSecondary,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    marginTop: spacing.md,
    marginBottom: spacing.xs,
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: 52,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceMuted,
  },
  input: { flex: 1, fontSize: fontSize.md, color: colors.text, padding: 0 },
  addressText: { flex: 1, fontSize: fontSize.md, color: colors.text },

  categoryGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  categoryChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    width: '48%',
    height: 52,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  categoryChipSelected: { borderColor: colors.primary, backgroundColor: `${colors.primary}11` },
  categoryText: { fontSize: fontSize.md, color: colors.textSecondary },
  categoryTextSelected: { color: colors.primary, fontWeight: fontWeight.semibold },

  footer: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    gap: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
});
