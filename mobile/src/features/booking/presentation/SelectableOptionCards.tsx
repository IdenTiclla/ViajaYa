import { Ionicons } from '@expo/vector-icons';
import type { ComponentProps } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { colors, fontSize, fontWeight, radius, spacing } from '@/core/theme';

type IconName = ComponentProps<typeof Ionicons>['name'];

export type SelectableOption<T extends string> = {
  id: T;
  label: string;
  icon: IconName;
  accessibilityLabel: string;
};

type Props<T extends string> = {
  options: readonly SelectableOption<T>[];
  value: T;
  onChange: (value: T) => void;
};

/** Tarjetas uniformes para elegir una única opción dentro de un formulario. */
export function SelectableOptionCards<T extends string>({ options, value, onChange }: Props<T>) {
  return (
    <View style={styles.cards}>
      {options.map((option) => {
        const selected = value === option.id;
        return (
          <TouchableOpacity
            key={option.id}
            style={[styles.card, selected && styles.cardSelected]}
            onPress={() => onChange(option.id)}
            accessibilityRole="radio"
            accessibilityState={{ checked: selected }}
            accessibilityLabel={option.accessibilityLabel}>
            <View style={[styles.icon, selected && styles.iconSelected]}>
              <Ionicons
                name={option.icon}
                size={20}
                color={selected ? colors.textOnPrimary : colors.primaryDark}
              />
            </View>
            <Text style={[styles.label, selected && styles.labelSelected]}>
              {option.label}
            </Text>
            <Text
              accessible={false}
              style={[styles.selectedBadge, !selected && styles.hiddenBadge]}>
              Seleccionado
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  cards: { flexDirection: 'row', gap: spacing.sm },
  card: {
    flex: 1,
    minWidth: 0,
    // El contenido crece con el tamaño de letra del sistema; todas las opciones
    // reservan el indicador para que la selección no cambie la altura de la fila.
    minHeight: 74,
    paddingHorizontal: spacing.xs,
    paddingVertical: spacing.xs,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'flex-start',
    gap: spacing.xs,
  },
  cardSelected: { borderColor: colors.primary, backgroundColor: colors.surfaceMuted },
  icon: {
    width: 20,
    height: 20,
    borderRadius: radius.sm,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconSelected: { backgroundColor: colors.primary },
  label: {
    fontSize: fontSize.xs,
    fontWeight: fontWeight.semibold,
    color: colors.text,
    textAlign: 'center',
  },
  labelSelected: { color: colors.primaryDark },
  selectedBadge: {
    marginTop: 'auto',
    alignSelf: 'center',
    paddingHorizontal: spacing.xs,
    paddingVertical: 1,
    borderRadius: radius.pill,
    backgroundColor: colors.primary,
    color: colors.textOnPrimary,
    fontSize: fontSize.xs,
    fontWeight: fontWeight.semibold,
  },
  hiddenBadge: { opacity: 0 },
});
