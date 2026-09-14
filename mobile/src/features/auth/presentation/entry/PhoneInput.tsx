import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { fontSize, fontWeight, radius, spacing, useEstilos, type Tema } from '@/core/theme';
import { TextField } from '@/shared/components';
import type { PhoneCapabilities } from '../../domain/phoneAccess';

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
  const { styles, estiloFoco } = useEstilos(createStyles);
  const [focusedRegion, setFocusedRegion] = useState<string | null>(null);
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
                onPress={() => onChangeCallingCode(country.callingCode)}
                onFocus={() => setFocusedRegion(country.region)} onBlur={() => setFocusedRegion(null)}
                style={[styles.chip, selected && styles.chipSelected, focusedRegion === country.region && estiloFoco]}>
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
        value={number} onChangeText={(value) => onChangeNumber(value.replace(/[^0-9]/g, ''))}
        keyboardType="phone-pad" autoComplete="tel-national" textContentType="telephoneNumber"
        maxLength={15} placeholder="71234567" editable={editable}
        accessibilityHint={`Código de país ${callingCode}`} />
    </View>
  );
}

const createStyles = ({ colors }: Tema) => StyleSheet.create({
  wrapper: { gap: spacing.sm },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chip: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.xs, minHeight: 40,
    paddingHorizontal: spacing.md, borderRadius: radius.pill, borderWidth: 1,
    borderColor: colors.bordeControl, backgroundColor: colors.surfaceMuted,
  },
  chipSelected: { borderColor: colors.primary, backgroundColor: colors.primarioSuave },
  chipFlag: { fontSize: fontSize.md },
  chipText: { fontSize: fontSize.sm, color: colors.textSecondary },
  chipTextSelected: { color: colors.primary, fontWeight: fontWeight.semibold },
});
