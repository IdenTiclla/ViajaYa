import { createContext, useContext, useMemo } from 'react';

import { getTheme, DEFAULT_THEME_MODE, type Theme } from './tokens';

export const ThemeContext = createContext<Theme>(getTheme(DEFAULT_THEME_MODE));

export function useTheme() {
  return useContext(ThemeContext);
}

/** Recompute only the styles; switching theme keeps screens and state. */
export function useThemedStyles<T>(createStyles: (theme: Theme) => T) {
  const theme = useTheme();
  const styles = useMemo(() => createStyles(theme), [createStyles, theme]);
  return { ...theme, styles };
}
