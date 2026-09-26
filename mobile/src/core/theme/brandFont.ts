import { useFonts } from 'expo-font';
import type { TextStyle } from 'react-native';

/** Ubuntu Bold: the typeface of the «ViajaYa» wordmark in the logo and splash. */
const BRAND_FONT_FAMILY = 'Ubuntu-Bold';

/**
 * Loads the brand typeface at runtime and returns the style that applies it.
 * Until it loads (or if it fails), returns `undefined` so text keeps the system bold.
 * The weight is reset because the file already is the bold cut; Android would synthesize another one.
 */
export function useBrandFontStyle(): TextStyle | undefined {
  const [loaded] = useFonts({ [BRAND_FONT_FAMILY]: require('@/assets/fonts/Ubuntu-Bold.ttf') });
  return loaded ? { fontFamily: BRAND_FONT_FAMILY, fontWeight: 'normal' } : undefined;
}
