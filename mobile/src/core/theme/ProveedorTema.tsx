import { DarkTheme, DefaultTheme, ThemeProvider } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as SystemUI from 'expo-system-ui';
import { useEffect, useLayoutEffect, useMemo, type PropsWithChildren } from 'react';
import { Appearance, Platform } from 'react-native';

import { obtenerTema, TEMA_PREDETERMINADO } from './tokens';
import { usePreferenciaTema } from './usePreferenciaTema';
import { ContextoTema } from './useTema';

// Controla también diálogos y campos nativos desde el arranque del JS.
if (Platform.OS !== 'web') Appearance.setColorScheme(TEMA_PREDETERMINADO);

export function ProveedorTema({ children }: PropsWithChildren) {
  const { modo, cargar } = usePreferenciaTema();
  const tema = useMemo(() => obtenerTema(modo), [modo]);
  const navegacion = useMemo(() => ({
    ...(modo === 'dark' ? DarkTheme : DefaultTheme),
    colors: {
      ...(modo === 'dark' ? DarkTheme : DefaultTheme).colors,
      primary: tema.colors.primary,
      background: tema.colors.background,
      card: tema.colors.surface,
      text: tema.colors.text,
      border: tema.colors.border,
      notification: tema.colors.danger,
    },
  }), [modo, tema]);

  useEffect(() => { void cargar(); }, [cargar]);

  useLayoutEffect(() => {
    if (Platform.OS === 'web') {
      document.documentElement.style.colorScheme = modo;
    } else {
      Appearance.setColorScheme(modo);
    }
    void SystemUI.setBackgroundColorAsync(tema.colors.background).catch(() => undefined);
  }, [modo, tema]);

  return (
    <ContextoTema.Provider value={tema}>
      <ThemeProvider value={navegacion}>
        <StatusBar style={modo === 'dark' ? 'light' : 'dark'} />
        {children}
      </ThemeProvider>
    </ContextoTema.Provider>
  );
}
