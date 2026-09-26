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

/** A problem with the typed number; `incomplete` ones are only worth showing once the user leaves the field. */
export type PhoneInputIssue = { message: string; incomplete: boolean };

const BOLIVIA_CALLING_CODE = '+591';
/** SMS codes only reach mobiles: in Bolivia they have 8 digits and start with 6 or 7. */
const BOLIVIA_MOBILE_LENGTH = 8;

/** Input bounds plus Bolivia's mobile format; the server still validates every country's numbering rules. */
export function getPhoneInputIssue(number: string, callingCode: string): PhoneInputIssue | undefined {
  if (!number) return undefined;
  if (!/^[0-9]+$/.test(number)) {
    return { message: 'El código de país no está disponible. Elige un país e ingresa el número sin prefijo.', incomplete: false };
  }
  if (callingCode.length - 1 + number.length > 15) {
    return { message: 'El número es demasiado largo. Revisa el código de país y los dígitos.', incomplete: false };
  }
  if (callingCode === BOLIVIA_CALLING_CODE) {
    if (!/^[67]/.test(number)) return { message: 'En Bolivia, los celulares empiezan con 6 o 7.', incomplete: false };
    if (number.length > BOLIVIA_MOBILE_LENGTH) {
      return { message: 'Los celulares de Bolivia tienen 8 dígitos.', incomplete: false };
    }
    if (number.length < BOLIVIA_MOBILE_LENGTH) {
      return { message: 'Ingresa tu número completo: 8 dígitos.', incomplete: true };
    }
    return undefined;
  }
  if (number.length < 6) return { message: 'Ingresa tu número completo, sin el código de país.', incomplete: true };
  return undefined;
}

export function getPhoneInputError(number: string, callingCode: string): string | undefined {
  return getPhoneInputIssue(number, callingCode)?.message;
}

/** Format hint shown under the field before any error. */
export function getPhoneInputHint(callingCode: string): string | undefined {
  return callingCode === BOLIVIA_CALLING_CODE ? 'Celular de 8 dígitos que empieza con 6 o 7.' : undefined;
}
