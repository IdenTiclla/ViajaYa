/**
 * Modal de contraoferta del conductor: precio propio (Bs) + ETA (min).
 */
import { useState } from 'react';
import {
  Modal,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';

import { colors, fontSize, fontWeight, radius, spacing } from '@/core/theme';

type Props = {
  visible: boolean;
  /** Oferta de referencia del pasajero (Bs), para mostrarla. */
  riderFare: number;
  submitting: boolean;
  onCancel: () => void;
  onSubmit: (price: number, etaMin: number | undefined) => void;
};

export function CounterOfferModal({ visible, riderFare, submitting, onCancel, onSubmit }: Props) {
  const [price, setPrice] = useState('');
  const [eta, setEta] = useState('');

  const priceValue = Number.parseFloat(price.replace(',', '.'));
  const priceIsValid = Number.isFinite(priceValue) && priceValue > 0;
  const etaValue = Number.parseInt(eta, 10);

  const submit = () => {
    if (!priceIsValid || submitting) return;
    onSubmit(priceValue, Number.isFinite(etaValue) ? etaValue : undefined);
    setPrice('');
    setEta('');
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onCancel}>
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <Text style={styles.title}>Contraoferta</Text>
          <Text style={styles.subtitle}>El pasajero ofrece Bs {riderFare.toFixed(2)}</Text>

          <Text style={styles.label}>Tu precio</Text>
          <View style={styles.inputRow}>
            <Text style={styles.currency}>Bs</Text>
            <TextInput
              style={styles.input}
              value={price}
              onChangeText={setPrice}
              placeholder="0.00"
              placeholderTextColor={colors.placeholder}
              keyboardType="decimal-pad"
              accessibilityLabel="Tu precio en bolivianos"
            />
          </View>

          <Text style={styles.label}>Tiempo estimado de llegada (min)</Text>
          <View style={styles.inputRow}>
            <TextInput
              style={styles.input}
              value={eta}
              onChangeText={setEta}
              placeholder="5"
              placeholderTextColor={colors.placeholder}
              keyboardType="number-pad"
              accessibilityLabel="Tiempo estimado de llegada en minutos"
            />
          </View>

          <View style={styles.actions}>
            <TouchableOpacity
              style={[styles.button, styles.cancel]}
              onPress={onCancel}
              accessibilityRole="button">
              <Text style={styles.cancelText}>Cancelar</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.button, styles.submit, (!priceIsValid || submitting) && styles.disabled]}
              onPress={submit}
              disabled={!priceIsValid || submitting}
              accessibilityRole="button">
              <Text style={styles.submitText}>Enviar</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.4)' },
  sheet: {
    padding: spacing.lg,
    gap: spacing.sm,
    backgroundColor: colors.background,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
  },
  title: { fontSize: fontSize.lg, fontWeight: fontWeight.bold, color: colors.text },
  subtitle: { fontSize: fontSize.sm, color: colors.textSecondary, marginBottom: spacing.sm },
  label: { fontSize: fontSize.sm, fontWeight: fontWeight.semibold, color: colors.text },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    height: 52,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  currency: { fontSize: fontSize.md, fontWeight: fontWeight.semibold, color: colors.textSecondary },
  input: { flex: 1, fontSize: fontSize.lg, fontWeight: fontWeight.semibold, color: colors.text, padding: 0 },

  actions: { flexDirection: 'row', gap: spacing.md, marginTop: spacing.md },
  button: { flex: 1, height: 50, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
  cancel: { backgroundColor: colors.surfaceMuted },
  cancelText: { fontSize: fontSize.md, fontWeight: fontWeight.semibold, color: colors.text },
  submit: { backgroundColor: colors.primary },
  submitText: { fontSize: fontSize.md, fontWeight: fontWeight.bold, color: colors.textOnPrimary },
  disabled: { opacity: 0.5 },
});
