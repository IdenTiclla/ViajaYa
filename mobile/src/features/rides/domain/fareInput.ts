/**
 * Lógica pura del teclado de monto "entero-primero": los dígitos entran como
 * bolivianos (enteros) por defecto y una tecla `.` activa hasta 2 centavos.
 *
 * Sin React ni IO: es un reducer testeable en aislado. `15` → 15.00; `15.5` →
 * 15.50; `0.99` → 0.99. Prioriza enteros (la mayoría de las ofertas son Bs
 * redondos).
 */

export type FareMode = 'absolute' | 'increment';

export interface FareInputState {
  /** Parte entera (bolivianos) sin leading zeros. Vacío = 0. */
  intPart: string;
  /** Parte decimal (centavos), 0-2 dígitos. */
  fracPart: string;
  /** True cuando se presionó `.`: los próximos dígitos van a centavos. */
  decimalActive: boolean;
}

export const MAX_INT_DIGITS = 6;
export const MAX_FRAC_DIGITS = 2;

const ZERO_STATE: FareInputState = { intPart: '', fracPart: '', decimalActive: false };

/** Hidrata el estado desde un número (p. ej. al editar/reabrir el keypad). */
export function fromValue(value: number | null | undefined): FareInputState {
  if (value == null || !Number.isFinite(value) || value <= 0) return { ...ZERO_STATE };
  const rounded = Math.round(value * 100) / 100;
  const [intStr, fracStr = ''] = rounded.toFixed(2).split('.');
  const intPart = String(Number.parseInt(intStr, 10));
  const fracTrimmed = fracStr.replace(/0+$/, ''); // omite centavos en cero
  return {
    intPart,
    fracPart: fracTrimmed,
    decimalActive: fracTrimmed.length > 0,
  };
}

/** Valor numérico ( Bs ) del estado. */
export function toValue(state: FareInputState): number {
  const intNum = state.intPart === '' ? 0 : Number.parseInt(state.intPart, 10);
  const fracNum = state.fracPart === '' ? 0 : Number.parseInt(state.fracPart.padEnd(2, '0'), 10);
  return Number.parseFloat((intNum + fracNum / 100).toFixed(2));
}

/** Display con formato `Bs X.XX` o `+Bs X.XX` según el modo. */
export function toDisplay(state: FareInputState, mode: FareMode): string {
  const prefix = mode === 'increment' ? '+Bs ' : 'Bs ';
  const intPart = state.intPart === '' ? '0' : state.intPart;
  const frac2 = state.fracPart.padEnd(2, '0'); // ''→'00', '5'→'50', '55'→'55'
  return `${prefix}${intPart}.${frac2}`;
}

/** ¿Tiene un monto válido (> 0) para confirmar? */
export function canSubmit(state: FareInputState): boolean {
  return toValue(state) > 0;
}

export function pressDigit(state: FareInputState, digit: string): FareInputState {
  if (state.decimalActive) {
    if (state.fracPart.length >= MAX_FRAC_DIGITS) return state;
    return { ...state, fracPart: state.fracPart + digit };
  }
  const trimmed = state.intPart.replace(/^0+/, '');
  if (trimmed.length >= MAX_INT_DIGITS) return state;
  let next = trimmed + digit;
  next = next.replace(/^0+(?=\d)/, ''); // sin leading zeros
  return { ...state, intPart: next };
}

export function pressDecimal(state: FareInputState): FareInputState {
  if (state.decimalActive) return state; // idempotente
  return { ...state, decimalActive: true };
}

export function pressDelete(state: FareInputState): FareInputState {
  if (state.fracPart !== '') {
    return { ...state, fracPart: state.fracPart.slice(0, -1) };
  }
  if (state.decimalActive) {
    return { ...state, decimalActive: false };
  }
  if (state.intPart !== '') {
    return { ...state, intPart: state.intPart.slice(0, -1) };
  }
  return state;
}
