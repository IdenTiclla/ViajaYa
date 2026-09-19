import type { PhoneCapabilities } from './phoneAccess';

type Countries = PhoneCapabilities['countries'];

/** Keep the selection within the countries currently offered by the server. */
export function resolveCallingCode(selected: string, countries: Countries): string {
  return countries.some((country) => country.callingCode === selected)
    ? selected
    : countries[0]?.callingCode ?? selected;
}

/** Recognize explicit international pastes without guessing from national digits. */
export function normalizePhoneInput(value: string, callingCode: string, countries: Countries) {
  const trimmed = value.trim();
  const digits = trimmed.replace(/[^0-9]/g, '');
  if (!trimmed.startsWith('+') && !trimmed.startsWith('00')) {
    return { callingCode, number: digits };
  }
  const international = `+${trimmed.startsWith('00') ? digits.slice(2) : digits}`;
  const country = [...countries]
    .sort((left, right) => right.callingCode.length - left.callingCode.length)
    .find((candidate) => international.startsWith(candidate.callingCode));
  return country
    ? { callingCode: country.callingCode, number: international.slice(country.callingCode.length) }
    // Retain an unsupported prefix so it cannot silently become a different number.
    : { callingCode, number: international };
}

/** Basic input bounds only; the server validates each country's numbering rules. */
export function getPhoneInputError(number: string, callingCode: string): string | undefined {
  if (!number) return undefined;
  if (!/^[0-9]+$/.test(number)) return 'El código de país no está disponible. Elige un país e ingresa el número sin prefijo.';
  if (number.length < 6) return 'Ingresa tu número completo, sin el código de país.';
  if (callingCode.length - 1 + number.length > 15) return 'El número es demasiado largo. Revisa el código de país y los dígitos.';
  return undefined;
}
