import { StyleSheet, Text, View } from 'react-native';

import { fontSize, fontWeight, radius, spacing, useThemedStyles, type Theme } from '@/core/theme';
import type { RichText } from '../domain/gateCopy';
import { RichLine } from './RichLine';

/** Numbered steps to turn the permission on from Settings. */
export function GateSteps({ steps }: { steps: RichText[] }) {
  const { styles } = useThemedStyles(createStyles);
  return (
    <View style={styles.list} accessibilityRole="list">
      {steps.map((step, index) => (
        <View key={index} style={styles.row} accessible accessibilityRole="text">
          <View style={styles.badge}>
            <Text style={styles.badgeText}>{index + 1}</Text>
          </View>
          <RichLine parts={step} style={styles.text} />
        </View>
      ))}
    </View>
  );
}

const createStyles = ({ colors }: Theme) => StyleSheet.create({
  list: { gap: spacing.sm + spacing.xs },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md - 2,
    paddingVertical: spacing.md - 2,
    paddingHorizontal: spacing.md,
    borderRadius: radius.lg,
    backgroundColor: colors.surfaceMuted,
  },
  badge: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: { color: colors.textOnPrimary, fontSize: fontSize.sm, fontWeight: fontWeight.bold },
  text: { flex: 1, color: colors.text, fontSize: fontSize.md, lineHeight: 22 },
});
