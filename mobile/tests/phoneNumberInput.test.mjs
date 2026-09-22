import assert from 'node:assert/strict';
import test from 'node:test';

import {
  getPhoneInputError,
  normalizePhoneInput,
  resolveCallingCode,
} from '../src/features/auth/domain/phoneNumberInput.ts';

const countries = [
  { region: 'BO', callingCode: '+591' },
  { region: 'PE', callingCode: '+51' },
  { region: 'AR', callingCode: '+54' },
];

for (const input of ['+591 7123-4567', '00591 (712) 34567', '  +59171234567  ']) {
  test(`pasting ${input} does not duplicate the country prefix`, () => {
    assert.deepEqual(normalizePhoneInput(input, '+591', countries), {
      callingCode: '+591', number: '71234567',
    });
  });
}

test('an international paste selects the supported country it belongs to', () => {
  assert.deepEqual(normalizePhoneInput('+51 912 345 678', '+591', countries), {
    callingCode: '+51', number: '912345678',
  });
});

test('national digits are not mistaken for a country code', () => {
  assert.deepEqual(normalizePhoneInput('591 123 456', '+51', countries), {
    callingCode: '+51', number: '591123456',
  });
});

test('unsupported international numbers stay visibly invalid instead of changing destination', () => {
  const result = normalizePhoneInput('+1 (202) 555-0123', '+591', countries);
  assert.equal(result.number, '+12025550123');
  assert.equal(result.callingCode, '+591');
  assert.match(getPhoneInputError(result.number, result.callingCode), /país no está disponible/);
});

test('the default country follows server capabilities and preserves a supported selection', () => {
  assert.equal(resolveCallingCode('+591', countries.slice(1)), '+51');
  assert.equal(resolveCallingCode('+54', countries), '+54');
  assert.equal(resolveCallingCode('+591', []), '+591');
});

test('input bounds include the country prefix and never truncate a long paste', () => {
  assert.equal(getPhoneInputError('', '+591'), undefined);
  assert.match(getPhoneInputError('712', '+591'), /completo/);
  assert.equal(getPhoneInputError('71234567', '+591'), undefined);
  assert.equal(getPhoneInputError('123456789012', '+591'), undefined);
  const result = normalizePhoneInput('+591 123 456 789 012 3', '+591', countries);
  assert.equal(result.number, '1234567890123');
  assert.match(getPhoneInputError(result.number, result.callingCode), /demasiado largo/);
});
