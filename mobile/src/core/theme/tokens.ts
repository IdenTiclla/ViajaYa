/**
 * Design tokens de ViajaYa (TaxiGo), derivados del diseño en Stitch.
 * Única fuente de verdad de colores, espaciado, tipografía y radios (DRY).
 */

export const colors = {
  // Marca
  primary: '#16308C', // azul TaxiGo (botones, marca)
  primaryDark: '#0F2266',
  accent: '#F5C518', // amarillo (íconos de servicio, tab activo)

  // Superficies
  background: '#FFFFFF',
  surface: '#FFFFFF',
  surfaceMuted: '#F2F3F5', // fondo de inputs / tarjetas
  border: '#E2E4E8',

  // Texto
  text: '#1A1D23',
  textSecondary: '#60646C',
  textOnPrimary: '#FFFFFF',
  placeholder: '#9AA0A6',

  // Estado
  danger: '#D92D20',
  success: '#0F9D58',

  // Social
  google: '#FFFFFF',
  googleBorder: '#DADCE0',
  facebook: '#1877F2',
} as const;

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

export type Colors = typeof colors;
export type Spacing = typeof spacing;
