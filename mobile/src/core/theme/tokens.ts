/**
 * Design tokens de ViajaYa, derivados del diseño en Stitch.
 * Única fuente de verdad de colores, espaciado, tipografía y radios (DRY).
 */

export const colors = {
  // Marca
  primary: '#16308C', // azul principal (botones, marca)
  primaryDark: '#0F2266',
  accent: '#F5C518', // amarillo (íconos de servicio, tab activo)

  // Superficies
  background: '#FFFFFF',
  surface: '#FFFFFF',
  surfaceMuted: '#F3F5F8', // fondo de inputs / tarjetas
  border: '#DCE2EB', // separadores decorativos
  bordeControl: '#7D8796', // contorno visible de campos y controles sin seleccionar
  primarioSuave: '#EDF2FF',

  // Texto
  text: '#182230',
  textSecondary: '#536174',
  textOnPrimary: '#FFFFFF',
  placeholder: '#667085',
  fondoDeshabilitado: '#E5E9F0',
  textoDeshabilitado: '#536174',

  // Estado
  danger: '#C52C22',
  success: '#167347',
  peligroSuave: '#FFF0EE',

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

/** Tamaño táctil mínimo; la altura puede crecer con el texto del sistema. */
export const controles = { altoMinimo: 48 } as const;

/** Foco de teclado visible sin desplazar el contenido al entrar o salir. */
export const estiloFoco = {
  outlineColor: colors.primary,
  outlineWidth: 2,
  outlineOffset: 2,
} as const;

export type Colors = typeof colors;
export type Spacing = typeof spacing;
