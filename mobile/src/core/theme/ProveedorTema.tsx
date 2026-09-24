import { DarkTheme, DefaultTheme, ThemeProvider } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as SystemUI from 'expo-system-ui';
import { useEffect, useLayoutEffect, useMemo, type PropsWithChildren } from 'react';
import { Appearance, Platform } from 'react-native';

import { getTheme, DEFAULT_THEME_MODE } from './tokens';
import { useThemePreference } from './usePreferenciaTema';
import { ThemeContext } from './useTema';

// Also controls native dialogs and fields from JS startup.
if (Platform.OS !== 'web') Appearance.setColorScheme(DEFAULT_THEME_MODE);

export function AppThemeProvider({ children }: PropsWithChildren) {
  const { mode, load } = useThemePreference();
  const theme = useMemo(() => getTheme(mode), [mode]);
  const navigation = useMemo(() => ({
    ...(mode === 'dark' ? DarkTheme : DefaultTheme),
    colors: {
      ...(mode === 'dark' ? DarkTheme : DefaultTheme).colors,
      primary: theme.colors.primary,
      background: theme.colors.background,
      card: theme.colors.surface,
      text: theme.colors.text,
      border: theme.colors.border,
      notification: theme.colors.danger,
    },
  }), [mode, theme]);

  useEffect(() => { void load(); }, [load]);

  useLayoutEffect(() => {
    if (Platform.OS === 'web') {
      document.documentElement.style.colorScheme = mode;
    } else {
      Appearance.setColorScheme(mode);
    }
    void SystemUI.setBackgroundColorAsync(theme.colors.background).catch(() => undefined);
  }, [mode, theme]);

  return (
    <ThemeContext.Provider value={theme}>
      <ThemeProvider value={navigation}>
        <StatusBar style={mode === 'dark' ? 'light' : 'dark'} />
        {children}
      </ThemeProvider>
    </ThemeContext.Provider>
  );
}
