/**
 * ViajaYa design tokens, derived from the Stitch design.
 * Single source of truth for colors, spacing, typography and radii (DRY).
 */

export const lightColors = {
  // Marca
  primary: '#16308C', // azul principal (botones, marca)
  primaryDark: '#0F2266',
  accent: '#F5C518', // amarillo (íconos de servicio, tab activo)
  // Brand wordmark ground/text: fixed in both themes, like the logo and splash.
  brand: '#16308C',
  textOnBrand: '#FFFFFF',

  // Superficies
  background: '#FFFFFF',
  surface: '#FFFFFF',
  surfaceMuted: '#F3F5F8', // fondo de inputs / tarjetas
  border: '#DCE2EB', // separadores decorativos
  controlBorder: '#7D8796', // contorno visible de campos y controles sin seleccionar
  primarySoft: '#EDF2FF',

  // Texto
  text: '#182230',
  textSecondary: '#536174',
  textOnPrimary: '#FFFFFF',
  placeholder: '#667085',
  disabledBackground: '#E5E9F0',
  disabledText: '#536174',

  // Estado
  danger: '#C52C22',
  success: '#167347',
  dangerSoft: '#FFF0EE',
  dangerBorder: '#F5C6C2',
  successSoft: '#E8F5EE',
  warning: '#806000',
  warningSoft: '#FFF7DA',
  textOnAccent: '#352900',
  mapLand: '#EEF1F5',
  mapWater: '#BEDDEC',
  mapStreet: '#FFFFFF',
  mapMainRoad: '#DDE4EC',
  mapLabel: '#536174',
  mapOutline: '#FFFFFF',
  mapPark: '#D8E8DE',
  // Vehicle details: they keep their identity on both map styles.
  vehicleOutline: '#162238',
  vehicleReflection: '#E8F7FF',

  // Social
  google: '#FFFFFF',
  googleBorder: '#DADCE0',
  facebook: '#1877F2',
} as const;

export type Colors = { [Clave in keyof typeof lightColors]: string };
export type ThemeMode = 'light' | 'dark';

export const darkColors: Colors = {
  ...lightColors,
  primary: '#A8BDFF',
  primaryDark: '#8DA8F7',
  background: '#10151F',
  surface: '#192230',
  surfaceMuted: '#222D3D',
  border: '#3B485C',
  controlBorder: '#8999AF',
  primarySoft: '#273856',
  text: '#F3F6FC',
  textSecondary: '#B9C5D6',
  textOnPrimary: '#10204E',
  placeholder: '#AAB8CC',
  disabledBackground: '#2D3849',
  disabledText: '#ADBACD',
  danger: '#FFAAA2',
  success: '#83DEAE',
  dangerSoft: '#43292D',
  dangerBorder: '#885057',
  successSoft: '#193C31',
  warning: '#F5D76B',
  warningSoft: '#382F15',
  facebook: '#85BAFF',
  mapLand: '#172231',
  mapWater: '#0D1725',
  mapStreet: '#334155',
  mapMainRoad: '#43536A',
  mapLabel: '#CBD5E1',
  mapOutline: '#172231',
  mapPark: '#203A34',
};

/** Light is the app's initial value, independent of the phone. */
export const DEFAULT_THEME_MODE: ThemeMode = 'light';

export function resolveThemeMode(valor: unknown): ThemeMode {
  return valor === 'dark' ? 'dark' : DEFAULT_THEME_MODE;
}

export function getTheme(mode: ThemeMode) {
  const colors: Colors = mode === 'dark' ? darkColors : lightColors;
  return {
    mode,
    colors,
    focusStyle: { outlineColor: colors.primary, outlineWidth: 2, outlineOffset: 2 } as const,
  };
}

export type Theme = ReturnType<typeof getTheme>;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 48,
} as const;

export const radius = {
  sm: 8,
  md: 12,
  lg: 16,
  pill: 999,
} as const;

export const fontSize = {
  xs: 12,
  sm: 14,
  md: 16,
  lg: 20,
  xl: 24,
  xxl: 32,
} as const;

export const fontWeight = {
  regular: '400',
  medium: '500',
  semibold: '600',
  bold: '700',
} as const;

/** Minimum touch size; the height can grow with the system text. */
export const controls = { minHeight: 48 } as const;

export type Spacing = typeof spacing;
