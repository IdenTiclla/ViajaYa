/**
 * "Lugares guardados" row of the passenger Home: one circle per shortcut
 * (Casa, Trabajo and the other favorites) plus "Agregar". A saved place is used
 * as the destination; a missing Casa/Trabajo opens the flow to set it.
 */
import { Ionicons } from '@react-native-vector-icons/ionicons';
import { useMemo } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { fontSize, fontWeight, radius, spacing, useThemedStyles, type Theme } from '@/core/theme';
import type { SavedPlace } from '@/features/booking/domain/types';
import { CATEGORY_META } from '@/features/booking/presentation/savedPlaceCategory';
import { buildSavedPlaceShortcuts } from '@/features/home/domain/savedPlaceShortcuts';

type Props = {
  places: SavedPlace[];
  isLoading: boolean;
  isError: boolean;
  onRetry: () => void;
  onSelect: (place: SavedPlace) => void;
  onSetUp: (category: 'home' | 'work') => void;
  onAdd: () => void;
  onManage: () => void;
};

const CIRCLE_SIZE = 52;

export function SavedPlaceShortcuts({
  places,
  isLoading,
  isError,
  onRetry,
  onSelect,
  onSetUp,
  onAdd,
  onManage,
}: Props) {
  const { colors, styles } = useThemedStyles(createStyles);
  const shortcuts = useMemo(() => buildSavedPlaceShortcuts(places), [places]);
  const disabled = isLoading || isError;

  return (
    <View style={styles.section}>
      <View style={styles.header}>
        <Text style={styles.title} accessibilityRole="header">Lugares guardados</Text>
        <TouchableOpacity
          style={styles.headerAction}
          onPress={onManage}
          accessibilityRole="button"
          accessibilityLabel="Editar lugares guardados">
          <Text style={styles.headerActionText}>Editar</Text>
        </TouchableOpacity>
      </View>

      {isError ? (
        <View style={styles.error}>
          <Text style={styles.errorText}>No pudimos cargar tus lugares.</Text>
          <TouchableOpacity onPress={onRetry} style={styles.headerAction} accessibilityRole="button">
            <Text style={styles.headerActionText}>Reintentar</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.row}>
          {shortcuts.map((shortcut) => {
            const saved = shortcut.kind === 'saved' ? shortcut.place : null;
            const meta = CATEGORY_META[shortcut.kind === 'saved' ? shortcut.place.category : shortcut.category];
            const label = saved?.label ?? meta.label;
            return (
              <TouchableOpacity
                key={shortcut.key}
                style={[styles.item, disabled && styles.disabled]}
                disabled={disabled}
                onPress={() =>
                  shortcut.kind === 'saved' ? onSelect(shortcut.place) : onSetUp(shortcut.category)
                }
                accessibilityRole="button"
                accessibilityState={{ disabled, busy: isLoading }}
                accessibilityLabel={saved ? `Ir a ${label}` : `Fijar ${label.toLowerCase()}`}>
                <View style={[styles.circle, !saved && styles.circlePending]}>
                  <Ionicons name={meta.icon} size={22} color={colors.primary} />
                </View>
                <Text style={styles.label} numberOfLines={1}>{label}</Text>
              </TouchableOpacity>
            );
          })}
          <TouchableOpacity
            style={[styles.item, disabled && styles.disabled]}
            disabled={disabled}
            onPress={onAdd}
            accessibilityRole="button"
            accessibilityLabel="Agregar lugar guardado">
            <View style={[styles.circle, styles.circleAdd]}>
              <Ionicons name="add" size={24} color={colors.primary} />
            </View>
            <Text style={[styles.label, styles.labelAdd]} numberOfLines={1}>Agregar</Text>
          </TouchableOpacity>
        </ScrollView>
      )}
    </View>
  );
}

const createStyles = ({ colors }: Theme) => StyleSheet.create({
  section: { gap: spacing.xs },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { fontSize: fontSize.md, fontWeight: fontWeight.bold, color: colors.text },
  headerAction: { minHeight: 44, justifyContent: 'center', paddingHorizontal: spacing.xs },
  headerActionText: { fontSize: fontSize.sm, fontWeight: fontWeight.bold, color: colors.primary },
  row: { gap: spacing.xs },
  item: { width: 76, alignItems: 'center', gap: 6 },
  disabled: { opacity: 0.5 },
  circle: {
    width: CIRCLE_SIZE,
    height: CIRCLE_SIZE,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.warningSoft,
  },
  // Casa/Trabajo not set yet: same place, muted so the saved ones stand out.
  circlePending: { backgroundColor: colors.surfaceMuted },
  circleAdd: {
    backgroundColor: 'transparent',
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: colors.controlBorder,
  },
  label: {
    fontSize: fontSize.xs,
    fontWeight: fontWeight.semibold,
    color: colors.text,
    textAlign: 'center',
  },
  labelAdd: { color: colors.primary, fontWeight: fontWeight.bold },
  error: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
  errorText: { flex: 1, fontSize: fontSize.sm, color: colors.textSecondary },
});
