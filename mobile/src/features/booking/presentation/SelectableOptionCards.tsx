import { Ionicons } from '@react-native-vector-icons/ionicons';
import { useState, type ComponentProps } from 'react';
import { Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';

import { controls, fontSize, fontWeight, radius, spacing, useThemedStyles, type Theme } from '@/core/theme';

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
  disabled?: boolean;
  columns?: 2;
};

/** Uniform cards to pick a single option within a form. */
export function SelectableOptionCards<T extends string>({ options, value, onChange, disabled = false, columns }: Props<T>) {
  const { colors, styles, focusStyle } = useThemedStyles(createStyles);
  const { fontScale } = useWindowDimensions();
  const [focused, setFocused] = useState<T | null>(null);
  const inColumn = fontScale > 1.3;
  return (
    <View style={[styles.cards, columns === 2 && !inColumn && styles.cardsGrid, inColumn && styles.cardsColumn]} accessibilityRole="radiogroup">
      {options.map((option) => {
        const selected = value === option.id;
        return (
          <Pressable
            key={option.id}
            style={({ pressed }) => [styles.card, columns === 2 && !inColumn && styles.cardGrid, inColumn && styles.cardRow, selected && styles.cardSelected, pressed && styles.pressed, focused === option.id && focusStyle]}
            disabled={disabled}
            onPress={() => { if (!selected) onChange(option.id); }}
            onFocus={() => setFocused(option.id)}
            onBlur={() => setFocused(null)}
            accessibilityRole="radio"
            accessibilityState={{ checked: selected, disabled }}
            aria-checked={selected}
            accessibilityLabel={option.accessibilityLabel}>
            <View style={[styles.icon, selected && styles.iconSelected]}>
              <Ionicons
                accessible={false}
                name={option.icon}
                size={20}
                color={selected ? colors.primary : colors.textSecondary}
              />
            </View>
            <Text style={[styles.label, inColumn && styles.labelRow, selected && styles.labelSelected]}>
              {option.label}
            </Text>
            <Ionicons
              accessible={false}
              name="checkmark-circle"
              size={16}
              color={colors.primary}
              style={[inColumn ? styles.checkRow : styles.check, !selected && styles.hiddenBadge]}
            />
          </Pressable>
        );
      })}
    </View>
  );
}

const createStyles = ({ colors }: Theme) => StyleSheet.create({
  cards: { flexDirection: 'row', gap: spacing.sm },
  cardsColumn: { flexDirection: 'column' },
  cardsGrid: { flexWrap: 'wrap' },
  cardGrid: { flexBasis: '45%', flexGrow: 1 },
  card: {
    flex: 1,
    minWidth: 0,
    minHeight: 60,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.controlBorder,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
  },
  cardRow: { flex: 0, minHeight: controls.minHeight, flexDirection: 'row', gap: spacing.sm, justifyContent: 'flex-start' },
  cardSelected: { borderColor: colors.primary, backgroundColor: colors.primarySoft },
  icon: {
    width: 20,
    height: 20,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconSelected: { backgroundColor: colors.primarySoft },
  label: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.semibold,
    color: colors.text,
    textAlign: 'center',
  },
  labelSelected: { color: colors.primaryDark },
  labelRow: { flex: 1, textAlign: 'left' },
  check: { position: 'absolute', right: spacing.xs, top: spacing.xs },
  checkRow: { marginLeft: 'auto' },
  pressed: { opacity: 0.92 },
  hiddenBadge: { opacity: 0 },
});
