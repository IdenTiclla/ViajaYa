import { Image, StyleSheet, Text, View, useWindowDimensions } from 'react-native';

import { fontSize, spacing, useThemedStyles, type Theme } from '@/core/theme';
// Imported directly: the theme barrel must stay loadable by the Node unit tests (no expo-font).
import { useBrandFontStyle } from '@/core/theme/brandFont';

/** Logical size of `auth-route.png` (drawn at 3x): the splash route entering the form sheet. */
const ART = { width: 390, height: 420 } as const;
/** Part of the art visible above the sheet at scale 1; the rest runs under it. */
const ART_VISIBLE = 356;
/** Corner radius of the sheet; the hero extends this much under it so the corners show the road. */
export const SHEET_RADIUS = 28;

type Props = { subtitle?: string; topInset: number };

/**
 * Brand header of the access view: wordmark + slogan over the yellow route of the splash,
 * with the taxi and the mototaxi. It shrinks on short screens so the form keeps its room.
 */
export function AuthHero({ subtitle, topInset }: Props) {
  const { styles } = useThemedStyles(createStyles);
  const brandFont = useBrandFontStyle();
  const { width, height } = useWindowDimensions();
  const visible = Math.min(ART_VISIBLE, Math.max(220, Math.round(height * 0.42)));
  const scale = Math.min(width / ART.width, visible / ART_VISIBLE);
  return (
    <View style={[styles.hero, { minHeight: topInset + visible + SHEET_RADIUS,
      paddingTop: topInset + spacing.xl }]}>
      <Image source={require('@/assets/images/auth-route.png')} resizeMode="contain"
        accessible={false} importantForAccessibility="no"
        style={[styles.art, { top: topInset, width: ART.width * scale, height: ART.height * scale }]} />
      <View style={styles.brand}>
        <Text accessibilityRole="header" accessibilityLabel="ViajaYa" maxFontSizeMultiplier={1.2}
          style={[styles.wordmark, brandFont]}>
          Viaja<Text style={styles.ya}>Ya</Text>
        </Text>
        {subtitle && <Text maxFontSizeMultiplier={1.6} style={styles.subtitle}>{subtitle}</Text>}
      </View>
    </View>
  );
}

// Brand navy and the white/yellow wordmark stay fixed in both themes, like the logo and splash.
const createStyles = ({ colors }: Theme) => StyleSheet.create({
  hero: { backgroundColor: colors.brand, overflow: 'hidden', paddingHorizontal: spacing.lg,
    paddingBottom: SHEET_RADIUS + spacing.md },
  art: { position: 'absolute', right: 0 },
  brand: { gap: spacing.xs },
  wordmark: { fontSize: 40, lineHeight: 44, fontWeight: 'bold', color: colors.textOnBrand },
  ya: { color: colors.accent },
  subtitle: { maxWidth: '46%', fontSize: fontSize.md, lineHeight: 21, color: colors.textOnBrand, opacity: 0.88 },
});
