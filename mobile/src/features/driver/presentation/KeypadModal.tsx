/**
 * Modal de contraoferta con teclado numérico propio (sin teclado del sistema):
 * el conductor ingresa su precio (Bs) tocando teclas. Reemplaza al
 * `CounterOfferModal` con `TextInput`.
 *
 * El monto se acumula como centavos (string) y se muestra como `Bs X.XX`.
 */
import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { ActivityIndicator, Modal, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { colors, fontSize, fontWeight, radius, spacing } from '@/core/theme';

type Props = {
  visible: boolean;
  /** Oferta de referencia del pasajero (Bs), para mostrarla. */
  riderFare: number;
  submitting: boolean;
  onCancel: () => void;
  onSubmit: (price: number) => void;
};

const EMPTY = '0';
const MAX_DIGITS = 6;

// Cuatro filas de tres teclas (1-9, 0, borrar, OK).
const ROWS: { kind: 'digit' | 'delete' | 'ok'; label?: string }[][] = [
  [
    { kind: 'digit', label: '1' },
    { kind: 'digit', label: '2' },
    { kind: 'digit', label: '3' },
  ],
  [
    { kind: 'digit', label: '4' },
    { kind: 'digit', label: '5' },
    { kind: 'digit', label: '6' },
  ],
  [
    { kind: 'digit', label: '7' },
    { kind: 'digit', label: '8' },
    { kind: 'digit', label: '9' },
  ],
  [
    { kind: 'digit', label: '0' },
    { kind: 'delete' },
    { kind: 'ok' },
  ],
];

export function KeypadModal({ visible, riderFare, submitting, onCancel, onSubmit }: Props) {
  // El display se resetea al remontar: el padre pasa `key={rideId}` para que cada
  // solicitud empiece en cero.
  const [cents, setCents] = useState(EMPTY);

  const price = Number.parseInt(cents || '0', 10) / 100;
  const canSubmit = price > 0 && !submitting;

  const pressDigit = (d: string) => {
    setCents((prev) => {
      if (prev === '0') return d;
      if (prev.length >= MAX_DIGITS) return prev;
      return prev + d;
    });
  };
  const pressDelete = () => {
    setCents((prev) => (prev.length <= 1 ? '0' : prev.slice(0, -1)));
  };
  const submit = () => {
    if (!canSubmit) return;
    onSubmit(Number.parseFloat(price.toFixed(2)));
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onCancel}>
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <View style={styles.header}>
            <View>
              <Text style={styles.title}>Tu contraoferta</Text>
              <Text style={styles.subtitle}>El pasajero ofrece Bs {riderFare.toFixed(2)}</Text>
            </View>
            <TouchableOpacity
              style={styles.closeBtn}
              onPress={onCancel}
              accessibilityRole="button"
              accessibilityLabel="Cerrar">
              <Ionicons name="close" size={20} color={colors.text} />
            </TouchableOpacity>
          </View>

          <View style={styles.display}>
            <Text style={styles.displayPrefix}>Bs</Text>
            <Text style={styles.displayValue}>{price.toFixed(2)}</Text>
          </View>

          <View style={styles.grid}>
            {ROWS.map((row, ri) => (
              <View key={ri} style={styles.row}>
                {row.map((key, ki) => {
                  if (key.kind === 'delete') {
                    return (
                      <TouchableOpacity
                        key={ki}
                        style={styles.key}
                        onPress={pressDelete}
                        accessibilityRole="button"
                        accessibilityLabel="Borrar dígito">
                        <Ionicons name="backspace-outline" size={22} color={colors.text} />
                      </TouchableOpacity>
                    );
                  }
                  if (key.kind === 'ok') {
                    return (
                      <TouchableOpacity
                        key={ki}
                        style={[styles.key, styles.keyOk, !canSubmit && styles.keyDisabled]}
                        onPress={submit}
                        disabled={!canSubmit}
                        accessibilityRole="button"
                        accessibilityLabel="Confirmar contraoferta">
                        {submitting ? (
                          <ActivityIndicator color={colors.textOnPrimary} />
                        ) : (
                          <Text style={styles.keyOkText}>OK</Text>
                        )}
                      </TouchableOpacity>
                    );
                  }
                  return (
                    <TouchableOpacity
                      key={ki}
                      style={styles.key}
                      onPress={() => pressDigit(key.label!)}
                      accessibilityRole="button"
                      accessibilityLabel={key.label}>
                      <Text style={styles.keyText}>{key.label}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            ))}
          </View>
        </View>
      </View>
    </Modal>
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
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceMuted,
  },
  displayPrefix: { fontSize: fontSize.lg, fontWeight: fontWeight.semibold, color: colors.textSecondary },
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
  keyText: { fontSize: fontSize.xl, fontWeight: fontWeight.bold, color: colors.text },
  keyOk: { backgroundColor: colors.primary },
  keyOkText: { fontSize: fontSize.lg, fontWeight: fontWeight.bold, color: colors.textOnPrimary },
  keyDisabled: { opacity: 0.5 },
});
