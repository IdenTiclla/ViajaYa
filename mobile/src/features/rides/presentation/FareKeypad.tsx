/**
 * Teclado de monto reutilizable (pasajero y conductor). Entero-primero: los
 * dígitos entran como bolivianos y una tecla `.` activa hasta 2 centavos.
 *
 * Reemplaza al `KeypadModal` (que acumulaba en centavos) y al `CounterOfferModal`
 * (TextInput stock). La lógica vive en `features/rides/domain/fareInput.ts`.
 */
import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { ActivityIndicator, Modal, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { colors, fontSize, fontWeight, radius, spacing } from '@/core/theme';
import {
  type FareMode,
  canSubmit,
  fromValue,
  pressDecimal,
  pressDelete,
  pressDigit,
  toDisplay,
  toValue,
} from '@/features/rides/domain/fareInput';

type Props = {
  visible: boolean;
  /** `absolute` → `Bs X.XX` (oferta inicial / contraoferta). `increment` → `+Bs X.XX`. */
  mode?: FareMode;
  /** Subtítulo libre bajo el título (p. ej. "El pasajero ofrece Bs 15.00"). */
  subtitle?: string;
  /** Valor inicial al abrir (edición/mejora); resetea al remontar con `key`. */
  initialValue?: number;
  submitting?: boolean;
  submitLabel?: string;
  onCancel: () => void;
  onSubmit: (amountBs: number) => void;
};

const DIGITS = ['1', '2', '3', '4', '5', '6', '7', '8', '9'];

export function FareKeypad({
  visible,
  mode = 'absolute',
  subtitle,
  initialValue,
  submitting = false,
  submitLabel = 'OK',
  onCancel,
  onSubmit,
}: Props) {
  const [state, setState] = useState(() => fromValue(initialValue));
  const value = toValue(state);
  const ready = canSubmit(state) && !submitting;
  const decimalOn = state.decimalActive;

  const submit = () => {
    if (!ready) return;
    onSubmit(value);
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onCancel}>
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <View style={styles.header}>
            <View>
              <Text style={styles.title}>
                {mode === 'increment' ? 'Aumentar oferta' : 'Ingresa el monto'}
              </Text>
              {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
            </View>
            <TouchableOpacity
              style={styles.closeBtn}
              onPress={onCancel}
              accessibilityRole="button"
              accessibilityLabel="Cerrar">
              <Ionicons name="close" size={20} color={colors.text} />
            </TouchableOpacity>
          </View>

          <View
            style={styles.display}
            accessibilityRole="text"
            accessibilityLabel={`Monto ${toDisplay(state, mode)}`}>
            <Text style={styles.displayValue}>{toDisplay(state, mode)}</Text>
          </View>

          <View style={styles.grid}>
            <View style={styles.row}>
              {DIGITS.slice(0, 3).map((d) => (
                <DigitKey key={d} label={d} onPress={() => setState((s) => pressDigit(s, d))} />
              ))}
            </View>
            <View style={styles.row}>
              {DIGITS.slice(3, 6).map((d) => (
                <DigitKey key={d} label={d} onPress={() => setState((s) => pressDigit(s, d))} />
              ))}
            </View>
            <View style={styles.row}>
              {DIGITS.slice(6, 9).map((d) => (
                <DigitKey key={d} label={d} onPress={() => setState((s) => pressDigit(s, d))} />
              ))}
            </View>
            <View style={styles.row}>
              <DigitKey
                label="."
                highlight={decimalOn}
                onPress={() => setState((s) => pressDecimal(s))}
              />
              <DigitKey label="0" onPress={() => setState((s) => pressDigit(s, '0'))} />
              <TouchableOpacity
                style={styles.key}
                onPress={() => setState((s) => pressDelete(s))}
                accessibilityRole="button"
                accessibilityLabel="Borrar dígito">
                <Ionicons name="backspace-outline" size={22} color={colors.text} />
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.key, styles.keyOk, !ready && styles.keyDisabled]}
                onPress={submit}
                disabled={!ready}
                accessibilityRole="button"
                accessibilityLabel={`Confirmar ${toDisplay(state, mode)}`}>
                {submitting ? (
                  <ActivityIndicator color={colors.textOnPrimary} />
                ) : (
                  <Text style={styles.keyOkText}>{submitLabel}</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </View>
    </Modal>
  );
}

function DigitKey({
  label,
  highlight,
  onPress,
}: {
  label: string;
  highlight?: boolean;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity
      style={[styles.key, highlight && styles.keyHighlight]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label === '.' ? 'Punto decimal' : label}>
      <Text style={styles.keyText}>{label}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.45)' },
  sheet: {
    padding: spacing.lg,
    paddingBottom: spacing.xl,
    gap: spacing.md,
    backgroundColor: colors.background,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: -3 },
    elevation: 16,
  },
  header: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' },
  title: { fontSize: fontSize.lg, fontWeight: fontWeight.bold, color: colors.text },
  subtitle: { fontSize: fontSize.sm, color: colors.textSecondary, marginTop: 2 },
  closeBtn: {
    width: 40,
    height: 40,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceMuted,
    alignItems: 'center',
    justifyContent: 'center',
  },
  display: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceMuted,
  },
  displayValue: { fontSize: fontSize.xxl, fontWeight: fontWeight.bold, color: colors.primary },
  grid: { gap: spacing.sm },
  row: { flexDirection: 'row', gap: spacing.sm },
  key: {
    flex: 1,
    height: 56,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceMuted,
    alignItems: 'center',
    justifyContent: 'center',
  },
  keyHighlight: { borderWidth: 2, borderColor: colors.primary, backgroundColor: colors.background },
  keyText: { fontSize: fontSize.xl, fontWeight: fontWeight.bold, color: colors.text },
  keyOk: { backgroundColor: colors.primary },
  keyOkText: { fontSize: fontSize.lg, fontWeight: fontWeight.bold, color: colors.textOnPrimary },
  keyDisabled: { opacity: 0.5 },
});
