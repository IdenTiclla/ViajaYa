/**
 * Counter-offer sheet (driver), opened from "Contraofertar" in the list or
 * the map: − / + stepper over a typed amount, quick amounts above the
 * passenger's fare and how far the price is from theirs. The arrival estimate
 * is computed from GPS when the offer is sent (`useOfferComposer`).
 */
import { Ionicons } from '@react-native-vector-icons/ionicons';
import { useState } from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { fontSize, fontWeight, radius, spacing, useThemedStyles, type Theme } from '@/core/theme';
import { useBrandFontStyle } from '@/core/theme/brandFont';
import { formatKm, haversineKm, pricePerKm } from '@/features/rides/domain/geo';
import { formatBolivianos, formatBolivianosInput } from '@/features/rides/domain/money';
import type { OpenRide } from '@/features/rides/domain/types';
import { Button, PersonAvatar } from '@/shared/components';

const QUICK_DELTAS = [1, 2, 3, 5] as const;
const PAYMENT_LABELS = { qr: 'QR', cash: 'Efectivo' } as const;

type Props = {
  /** Request being countered; null hides the sheet. */
  ride: OpenRide | null;
  busy: boolean;
  onClose: () => void;
  onSubmit: (price: number) => void;
};

export function CounterOfferSheet({ ride, busy, onClose, onSubmit }: Props) {
  const { styles } = useThemedStyles(createStyles);
  return (
    <Modal visible={ride != null} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <Pressable style={styles.backdrop} onPress={onClose} accessibilityRole="button"
          accessibilityLabel="Cerrar contraoferta" disabled={busy} />
        {/* Keyed by request so each opening starts from that passenger's fare. */}
        {ride && <SheetContent key={ride.id} ride={ride} busy={busy} onClose={onClose} onSubmit={onSubmit} />}
      </KeyboardAvoidingView>
    </Modal>
  );
}

function SheetContent({ ride, busy, onClose, onSubmit }: Props & { ride: OpenRide }) {
  const { colors, styles } = useThemedStyles(createStyles);
  const brandFont = useBrandFontStyle();
  const [input, setInput] = useState(() => formatBolivianosInput(ride.fare + QUICK_DELTAS[0]));
  const price = Number(input.replace(',', '.'));
  const valid = Number.isFinite(price) && price > 0;
  const first = ride.rider.fullName.trim().split(/\s+/)[0] ?? ride.rider.fullName;
  const tripKm = haversineKm(ride.origin.coordinates, ride.destination.coordinates);
  const perKm = valid ? pricePerKm(price, tripKm) : null;
  const delta = valid ? Math.round((price - ride.fare) * 100) / 100 : 0;
  const deltaText = delta > 0 ? `+Bs ${formatBolivianos(delta)} sobre su precio`
    : delta < 0 ? `Bs ${formatBolivianos(-delta)} menos que su precio` : 'Su mismo precio';

  const setPrice = (value: number) => setInput(formatBolivianosInput(Math.max(1, Math.round(value * 100) / 100)));
  const submit = () => {
    if (valid && !busy) onSubmit(Math.round(price * 100) / 100);
  };

  return (
    <SafeAreaView edges={['bottom']} style={styles.sheet} accessibilityViewIsModal>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" bounces={false}>
        <View style={styles.handle} />
        <View style={styles.header}>
          <PersonAvatar name={ride.rider.fullName} size={48} />
          <View style={styles.headerText}>
            <Text accessibilityRole="header" style={[styles.title, brandFont]}>Contraoferta para {first}</Text>
            <Text style={styles.subtitle}>
              Ofrece Bs {formatBolivianos(ride.fare)} · {formatKm(tripKm)} · {PAYMENT_LABELS[ride.payment]}
            </Text>
          </View>
          <TouchableOpacity style={styles.close} onPress={onClose} disabled={busy}
            accessibilityRole="button" accessibilityLabel="Cerrar">
            <Ionicons name="close" size={22} color={colors.text} />
          </TouchableOpacity>
        </View>

        <View style={styles.stepper}>
          <TouchableOpacity
            style={[styles.stepButton, (!valid || price <= 1) && styles.disabled]}
            onPress={() => setPrice(price - 1)}
            disabled={!valid || price <= 1 || busy}
            accessibilityRole="button"
            accessibilityLabel="Bajar un boliviano">
            <Ionicons name="remove" size={26} color={colors.primary} />
          </TouchableOpacity>
          <View style={styles.amount}>
            <Text style={styles.amountLabel}>Tu precio</Text>
            <View style={styles.amountRow}>
              <Text style={styles.currency}>Bs</Text>
              <TextInput
                value={input}
                onChangeText={setInput}
                selectTextOnFocus
                keyboardType="decimal-pad"
                inputMode="decimal"
                maxLength={9}
                returnKeyType="send"
                onSubmitEditing={submit}
                editable={!busy}
                placeholder="0"
                placeholderTextColor={colors.placeholder}
                style={[styles.amountInput, brandFont]}
                accessibilityLabel="Tu precio en bolivianos"
              />
            </View>
          </View>
          <TouchableOpacity
            style={[styles.stepButton, !valid && styles.disabled]}
            onPress={() => setPrice(price + 1)}
            disabled={!valid || busy}
            accessibilityRole="button"
            accessibilityLabel="Subir un boliviano">
            <Ionicons name="add" size={26} color={colors.primary} />
          </TouchableOpacity>
        </View>
        {valid && (
          <Text style={styles.delta} accessibilityLiveRegion="polite">
            {deltaText}{perKm ? ` · Bs ${perKm}/km` : ''}
          </Text>
        )}

        <View style={styles.quickBlock}>
          <Text style={styles.quickTitle}>Montos rápidos</Text>
          <View style={styles.quickRow}>
            {QUICK_DELTAS.map((step) => {
              const amount = Math.round((ride.fare + step) * 100) / 100;
              const selected = valid && amount === Math.round(price * 100) / 100;
              return (
                <TouchableOpacity
                  key={step}
                  style={[styles.quick, selected && styles.quickSelected]}
                  onPress={() => setPrice(amount)}
                  disabled={busy}
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                  accessibilityLabel={`Bs ${formatBolivianos(amount)}`}>
                  <Text style={[styles.quickText, selected && styles.quickTextSelected]}>
                    Bs {formatBolivianos(amount)}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>

        <View style={styles.hint}>
          <Ionicons name="time-outline" size={18} color={colors.primary} />
          <Text style={styles.hintText}>Tu llegada se calcula con tu GPS al enviar</Text>
        </View>

        <View style={styles.footer}>
          <Button
            title={valid ? `Enviar oferta · Bs ${formatBolivianos(price)}` : 'Escribe un monto'}
            onPress={submit}
            disabled={!valid}
            loading={busy}
            loadingLabel="Enviando oferta…"
          />
          <Text style={styles.footnote}>{first} tiene 30 s para responder.</Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const createStyles = ({ colors }: Theme) => StyleSheet.create({
  flex: { flex: 1, justifyContent: 'flex-end' },
  backdrop: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(0,0,0,0.5)' },
  sheet: {
    maxHeight: '90%',
    backgroundColor: colors.background,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
  },
  content: { paddingHorizontal: spacing.md, paddingTop: spacing.sm, paddingBottom: spacing.md, gap: spacing.md },
  handle: { alignSelf: 'center', width: 40, height: 4, borderRadius: radius.pill, backgroundColor: colors.border },
  header: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm + 4 },
  headerText: { flex: 1, minWidth: 0, gap: 2 },
  title: { fontSize: fontSize.lg + 2, fontWeight: fontWeight.bold, color: colors.text },
  subtitle: { fontSize: fontSize.sm, color: colors.textSecondary },
  close: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceMuted,
  },

  stepper: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm + 4,
    padding: spacing.sm + 4,
    borderRadius: radius.lg,
    backgroundColor: colors.surfaceMuted,
  },
  stepButton: {
    width: 56,
    height: 56,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.controlBorder,
  },
  amount: { flex: 1, minWidth: 0, alignItems: 'center' },
  amountLabel: { fontSize: fontSize.xs, color: colors.textSecondary },
  amountRow: { flexDirection: 'row', alignItems: 'baseline', gap: spacing.xs },
  currency: { fontSize: fontSize.lg + 2, fontWeight: fontWeight.bold, color: colors.text },
  amountInput: {
    minWidth: 64,
    maxWidth: 160,
    minHeight: 52,
    paddingVertical: 0,
    textAlign: 'center',
    fontSize: 38,
    fontWeight: fontWeight.bold,
    color: colors.text,
  },
  delta: {
    alignSelf: 'center',
    paddingHorizontal: spacing.sm + 4,
    paddingVertical: spacing.xs,
    borderRadius: radius.pill,
    overflow: 'hidden',
    backgroundColor: colors.warningSoft,
    color: colors.warning,
    fontSize: fontSize.sm,
    fontWeight: fontWeight.bold,
    textAlign: 'center',
  },

  quickBlock: { gap: spacing.sm },
  quickTitle: { fontSize: fontSize.sm, fontWeight: fontWeight.bold, color: colors.text },
  quickRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  quick: {
    flexGrow: 1,
    flexBasis: 64,
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.controlBorder,
  },
  quickSelected: { borderWidth: 2, borderColor: colors.primary, backgroundColor: colors.primarySoft },
  quickText: { fontSize: fontSize.md, fontWeight: fontWeight.bold, color: colors.text },
  quickTextSelected: { color: colors.primary },

  hint: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm + 2 },
  hintText: { flex: 1, fontSize: fontSize.sm, color: colors.textSecondary },
  footer: { gap: spacing.xs + 2 },
  footnote: { fontSize: fontSize.sm, color: colors.textSecondary, textAlign: 'center' },
  disabled: { opacity: 0.5 },
});
