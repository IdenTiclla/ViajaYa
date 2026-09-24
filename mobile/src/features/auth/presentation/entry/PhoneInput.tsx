import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { controls, fontSize, fontWeight, radius, spacing, useThemedStyles, type Theme } from '@/core/theme';
import { TextField } from '@/shared/components';
import type { PhoneCapabilities } from '../../domain/phoneAccess';
import { getPhoneInputError, normalizePhoneInput } from '../../domain/phoneNumberInput';

type Country = PhoneCapabilities['countries'][number];

type Props = {
  countries: Country[];
  callingCode: string;
  onChangeCallingCode: (code: string) => void;
  number: string;
  onChangeNumber: (digits: string) => void;
  label?: string;
  editable?: boolean;
};

const COUNTRY_NAMES: Record<string, string> = { BO: 'Bolivia', PE: 'Perú', AR: 'Argentina', CL: 'Chile' };

/** "BO" → 🇧🇴 via regional indicator symbols; returns the code itself for unknown input. */
function flag(region: string) {
  if (!/^[A-Z]{2}$/.test(region)) return region;
  return String.fromCodePoint(...[...region].map((char) => 0x1f1e6 + char.charCodeAt(0) - 65));
}

/** Country chips (only when there is more than one) + national number with the calling code as prefix. */
export function PhoneInput({ countries, callingCode, onChangeCallingCode, number, onChangeNumber,
  label = 'Número de teléfono', editable = true }: Props) {
  const { styles, focusStyle } = useThemedStyles(createStyles);
  const [focusedRegion, setFocusedRegion] = useState<string | null>(null);
  const [touched, setTouched] = useState(false);
  const error = getPhoneInputError(number, callingCode);
  return (
    <View style={styles.wrapper}>
      {countries.length > 1 && (
        <View accessibilityRole="radiogroup" accessibilityLabel="País" style={styles.chips}>
          {countries.map((country) => {
            const selected = country.callingCode === callingCode;
            return (
              <Pressable key={country.region} accessibilityRole="radio"
                accessibilityLabel={`${COUNTRY_NAMES[country.region] ?? country.region} ${country.callingCode}`}
                accessibilityState={{ selected, checked: selected, disabled: !editable }} disabled={!editable}
                aria-checked={selected}
                onPress={() => onChangeCallingCode(country.callingCode)}
                onFocus={() => setFocusedRegion(country.region)} onBlur={() => setFocusedRegion(null)}
                style={[styles.chip, selected && styles.chipSelected, !editable && styles.disabled,
                  focusedRegion === country.region && focusStyle]}>
                <Text style={styles.chipFlag}>{flag(country.region)}</Text>
                <Text style={[styles.chipText, selected && styles.chipTextSelected]}>
                  {COUNTRY_NAMES[country.region] ?? country.region} · {country.callingCode}
                </Text>
              </Pressable>
            );
          })}
        </View>
      )}
      <TextField label={label} prefix={callingCode} leadingIcon="call-outline"
        value={number} onChangeText={(value) => {
          const next = normalizePhoneInput(value, callingCode, countries);
          onChangeCallingCode(next.callingCode);
          onChangeNumber(next.number);
        }}
        onBlur={() => setTouched(true)} error={touched || number.startsWith('+') ? error : undefined}
        keyboardType="phone-pad" autoComplete="tel-national" textContentType="telephoneNumber"
        placeholder="Tu número sin prefijo" editable={editable}
        accessibilityHint={`Código de país ${callingCode}`} />
    </View>
  );
}

const createStyles = ({ colors }: Theme) => StyleSheet.create({
  wrapper: { gap: spacing.sm },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chip: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.xs, minHeight: controls.minHeight,
    maxWidth: '100%', paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radius.pill, borderWidth: 1,
    borderColor: colors.controlBorder, backgroundColor: colors.surfaceMuted,
  },
  chipSelected: { borderColor: colors.primary, backgroundColor: colors.primarySoft },
  chipFlag: { fontSize: fontSize.md },
  chipText: { flexShrink: 1, fontSize: fontSize.sm, color: colors.textSecondary },
  disabled: { opacity: 0.6 },
  chipTextSelected: { color: colors.primary, fontWeight: fontWeight.semibold },
});
