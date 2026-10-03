import { TripProgress } from '@/features/rides/presentation/TripProgress';
/**
 * Searching for offers (passenger) — Stitch "Searching for Offers" design.
 *
 * Background map with the route and a pulse on the origin; at the bottom a card
 * with the search status, the controls to **adjust the fare** and the action to
 * cancel the request. Shown while the ride is still
 * `searching` and no offers have arrived yet; when the first one arrives, `OffersScreen`
 * switches to the list.
 *
 * The search does not expire. When the fare is adjusted, the new amount is announced to the
 * drivers live.
 */
import { Ionicons } from '@react-native-vector-icons/ionicons';
import { useEffect, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { getApiErrorMessage } from '@/core/errors/apiError';
import { fontSize, fontWeight, radius, spacing, useThemedStyles, type Theme } from '@/core/theme';
import type { PaymentMethod, Place, ServiceType } from '@/features/booking/domain/types';
import { useRoute } from '@/features/booking/application/useRoute';
import { SERVICE_META } from '@/features/booking/domain/serviceCatalog';
import { formatKm } from '@/features/rides/domain/geo';
import {
  usePauseForEdit,
  useUpdateRideFare,
} from '@/features/rides/application/useRideMutations';
import { formatBolivianosInput } from '@/features/rides/domain/money';
import { TripRouteMap } from '@/features/rides/presentation/TripRouteMap';
import { MotorcycleRouteNotice } from '@/features/rides/presentation/MotorcycleRouteNotice';
import { ConfirmDialog } from '@/shared/components';

const OFFER_STEP = 1;
const RAISE_STEPS = [1, 2, 5] as const;

export function SearchingDriversScreen({
  rideId,
  service,
  payment,
  origin,
  destination,
  currentFare,
  connectionError,
  cancelPending,
  cancelError,
  onCancelRequest,
  onEditReady,
  onRetry,
}: {
  rideId: string | null;
  service: ServiceType;
  payment: PaymentMethod;
  origin: Place | null;
  destination: Place | null;
  /** Oferta vigente del viaje (en vivo). */
  currentFare: number | null;
  connectionError?: unknown;
  cancelPending: boolean;
  cancelError?: unknown;
  onCancelRequest: () => void;
  onEditReady: (rideId?: string) => void;
  onRetry?: () => void;
}) {
  const { colors, styles } = useThemedStyles(createStyles);
  const insets = useSafeAreaInsets();
  const updateFare = useUpdateRideFare();
  const pauseForEdit = usePauseForEdit();
  const { route } = useRoute(origin, destination, service);
  const negotiationBusy = cancelPending || updateFare.isPending || pauseForEdit.isPending;

  const [fareInput, setFareInput] = useState<string | null>(null);
  const pendingFareRef = useRef<number | null>(null);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [sheetHeight, setSheetHeight] = useState(0);
  const [headerHeight, setHeaderHeight] = useState(insets.top + 80);
  const [keyboardVisible, setKeyboardVisible] = useState(false);
  const hasConnectionError = connectionError != null;
  // The sheet has no fixed height: measuring it keeps the route from being
  // off-center or covered on small and large screens.
  const mapBottomPadding = sheetHeight > 0 ? sheetHeight : 440;

  useEffect(() => {
    const showSubscription = Keyboard.addListener('keyboardDidShow', () => {
      setKeyboardVisible(true);
    });
    const hideSubscription = Keyboard.addListener('keyboardDidHide', () => {
      setKeyboardVisible(false);
    });
    return () => {
      showSubscription.remove();
      hideSubscription.remove();
    };
  }, []);

  const onCancel = () => {
    setConfirmCancel(false);
    if (negotiationBusy) return;
    onCancelRequest();
  };

  const fareLocked = currentFare == null || negotiationBusy;
  const displayedFare = fareInput ?? (currentFare == null ? '' : formatBolivianosInput(currentFare));
  const typedFare = Number(displayedFare.replace(',', '.'));
  const typedFareIsValid = Number.isFinite(typedFare) && typedFare > 0;

  const updateCurrentFare = (nextFare: number) => {
    if (!rideId || fareLocked || !Number.isFinite(nextFare) || nextFare <= 0) return;
    const normalizedFare = Math.round(nextFare * 100) / 100;
    if (normalizedFare === currentFare || pendingFareRef.current != null) return;
    setFareInput(formatBolivianosInput(normalizedFare));
    pendingFareRef.current = normalizedFare;
    updateFare.mutate(
      { rideId, fare: normalizedFare },
      {
        onSettled: () => {
          pendingFareRef.current = null;
          setFareInput(null);
        },
      },
    );
  };

  const applyTypedFare = () => {
    if (!typedFareIsValid) {
      setFareInput(null);
      return;
    }
    if (typedFare === currentFare) setFareInput(null);
    updateCurrentFare(typedFare);
    Keyboard.dismiss();
  };

  const adjustFare = (delta: number) => {
    const baseFare = typedFareIsValid ? typedFare : currentFare;
    if (baseFare == null) return;
    updateCurrentFare(baseFare + delta);
  };

  const onBack = () => {
    if (negotiationBusy) return;
    if (!rideId) {
      onEditReady();
      return;
    }
    // Pause the search before editing: this hides it from the pool without cancelling it.
    pauseForEdit.mutate(rideId, {
      onSuccess: () => onEditReady(rideId),
    });
  };

  return (
    <View style={styles.root}>
      {origin && destination ? (
        <TripRouteMap
          service={service}
          origin={origin}
          destination={destination}
          topPadding={headerHeight}
          bottomPadding={mapBottomPadding}
          showPlaceNamesInTooltip
          showMotorcycleNotice={false}
        />
      ) : (
        <View style={styles.mapFallback} />
      )}

      <View style={styles.scrim} pointerEvents="box-none">
        <SafeAreaView edges={['top']} style={styles.backArea} pointerEvents="box-none"
          onLayout={(event) => setHeaderHeight(event.nativeEvent.layout.height)}>
          <TouchableOpacity
            style={[styles.backButton, negotiationBusy && styles.disabled]}
            onPress={onBack}
            disabled={negotiationBusy}
            accessibilityRole="button"
            accessibilityLabel="Volver">
            <Ionicons name="arrow-back" size={24} color={colors.text} />
          </TouchableOpacity>
          <View style={styles.tripChip}>
            <Ionicons name={SERVICE_META[service].icon} size={18} color={colors.primary} />
            <Text style={styles.tripChipText} numberOfLines={1}>
              {[SERVICE_META[service].label,
                route ? formatKm(route.distanceMeters / 1000) : null,
                route ? `${Math.max(1, Math.round(route.durationSeconds / 60))} min` : null]
                .filter(Boolean).join(' · ')}
            </Text>
          </View>
        </SafeAreaView>

        <KeyboardAvoidingView
          style={styles.sheetAvoider}
          behavior="padding"
          enabled={Platform.OS === 'ios' || keyboardVisible}
          keyboardVerticalOffset={0}
          pointerEvents="box-none">
          <SafeAreaView
            edges={['bottom']}
            style={styles.sheet}
            onLayout={(event) => {
              if (!keyboardVisible) setSheetHeight(event.nativeEvent.layout.height);
            }}>
            <ScrollView
              contentContainerStyle={styles.sheetContent}
              keyboardShouldPersistTaps="handled"
              keyboardDismissMode="on-drag"
              showsVerticalScrollIndicator={false}
              bounces={false}>
              <View style={styles.sheetHandle} />

          <TripProgress status="searching" />

          <View style={styles.statusRow} accessibilityLiveRegion="polite">
            <TouchableOpacity
              style={[styles.statusIcon, hasConnectionError && styles.statusIconError]}
              onPress={onRetry}
              disabled={!hasConnectionError || !onRetry}
              accessibilityRole={hasConnectionError ? 'button' : undefined}
              accessibilityLabel={hasConnectionError ? 'Reintentar conexión' : undefined}>
              {hasConnectionError
                ? <Ionicons name="refresh" size={24} color={colors.danger} />
                : <Ionicons name="search" size={26} color={colors.primary} />}
            </TouchableOpacity>
            <View style={styles.statusText}>
              <Text accessibilityRole="header" style={[styles.statusTitle, hasConnectionError && styles.offlineTitle]}>
                {hasConnectionError ? 'Reconectando…' : 'Buscando conductores'}
              </Text>
              <Text style={styles.statusSubtitle} numberOfLines={2}>
                {hasConnectionError
                  ? getApiErrorMessage(connectionError)
                  : 'Te avisaremos apenas llegue la primera oferta.'}
              </Text>
            </View>
          </View>
          <ProgressBar />

          <MotorcycleRouteNotice service={service} />

          <View style={[styles.offerCard, fareLocked && styles.disabled]}>
            <View style={styles.offerRow}>
              <View style={styles.offerAmount}>
                <Text style={styles.bidTitle}>Tu oferta</Text>
                <View style={styles.fareInputWrap}>
                  <Text style={styles.fareCurrency}>Bs</Text>
                  <TextInput
                    value={displayedFare}
                    onChangeText={setFareInput}
                    placeholder="0"
                    placeholderTextColor={colors.placeholder}
                    keyboardType="decimal-pad"
                    inputMode="decimal"
                    maxLength={9}
                    returnKeyType="done"
                    onSubmitEditing={applyTypedFare}
                    onBlur={applyTypedFare}
                    editable={!fareLocked}
                    style={styles.fareAmountInput}
                    accessibilityLabel="Precio de tu oferta en bolivianos"
                    accessibilityHint="Toca para escribir otro monto"
                  />
                </View>
              </View>
              <View style={styles.paymentChip}>
                <Ionicons name={payment === 'qr' ? 'qr-code-outline' : 'cash-outline'} size={16} color={colors.success} />
                <Text style={styles.paymentChipText}>{payment === 'qr' ? 'QR' : 'Efectivo'}</Text>
              </View>
              <TouchableOpacity
                style={styles.fareStepButton}
                onPress={() => adjustFare(-OFFER_STEP)}
                disabled={fareLocked || !typedFareIsValid || typedFare <= OFFER_STEP}
                accessibilityRole="button"
                accessibilityLabel="Bajar oferta en un boliviano">
                <Ionicons name="remove" size={22} color={colors.primary} />
              </TouchableOpacity>
            </View>
            <Text style={styles.raiseHint}>¿Pocas ofertas? Sube tu precio</Text>
            <View style={styles.raiseRow}>
              {RAISE_STEPS.map((step) => (
                <TouchableOpacity
                  key={step}
                  style={styles.raiseButton}
                  onPress={() => adjustFare(step)}
                  disabled={fareLocked}
                  accessibilityRole="button"
                  accessibilityLabel={`Subir oferta ${step} ${step === 1 ? 'boliviano' : 'bolivianos'}`}>
                  <Text style={styles.raiseText}>+ Bs {step}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          {updateFare.isError && (
            <Text style={styles.error}>{getApiErrorMessage(updateFare.error)}</Text>
          )}
          {cancelError != null && (
            <Text style={styles.error}>{getApiErrorMessage(cancelError)}</Text>
          )}
          {pauseForEdit.isError && (
            <Text style={styles.error}>{getApiErrorMessage(pauseForEdit.error)}</Text>
          )}

          <View style={styles.actionsRow}>
            <TouchableOpacity
              style={[styles.modify, negotiationBusy && styles.disabled]}
              onPress={onBack}
              disabled={negotiationBusy}
              accessibilityRole="button"
              accessibilityLabel="Modificar solicitud">
              <Ionicons name="create-outline" size={18} color={colors.text} />
              <Text style={styles.modifyText}>{pauseForEdit.isPending ? 'Abriendo…' : 'Modificar'}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.cancel, negotiationBusy && styles.disabled]}
              onPress={() => setConfirmCancel(true)}
              disabled={negotiationBusy}
              accessibilityRole="button"
              accessibilityLabel="Cancelar solicitud">
              <Text style={styles.cancelText}>
                {cancelPending ? 'Cancelando…' : 'Cancelar solicitud'}
              </Text>
            </TouchableOpacity>
          </View>
            </ScrollView>
          </SafeAreaView>
        </KeyboardAvoidingView>
      </View>

      <ConfirmDialog
        visible={confirmCancel}
        icon="warning"
        destructive
        title="¿Cancelar solicitud?"
        message="Si cancelas ahora, podrías perder las ofertas de conductores cercanos que ya están evaluando tu viaje."
        confirmText="Sí, cancelar"
        cancelText="No, seguir esperando"
        onConfirm={onCancel}
        onCancel={() => setConfirmCancel(false)}
      />

    </View>
  );
}

/** Indeterminate progress bar: a segment that loops along the track. */
function ProgressBar() {
  const { styles } = useThemedStyles(createStyles);
  const [progress] = useState(() => new Animated.Value(0));
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const loop = Animated.loop(
      Animated.timing(progress, {
        toValue: 1,
        duration: 1500,
        easing: Easing.inOut(Easing.ease),
        useNativeDriver: true,
      }),
    );
    loop.start();
    return () => loop.stop();
  }, [progress]);

  const translateX = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [-width * 0.4, width],
  });

  return (
    <View style={styles.progressTrack} onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
      <Animated.View style={[styles.progressBar, { transform: [{ translateX }] }]} />
    </View>
  );
}

const createStyles = ({ colors }: Theme) => StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surfaceMuted },
  mapFallback: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: colors.surfaceMuted },
  scrim: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },

  backArea: { position: 'absolute', top: 0, left: 0, right: 0, padding: spacing.md,
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  tripChip: {
    flexShrink: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs + 2,
    minHeight: 44,
    paddingHorizontal: spacing.md,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    shadowColor: '#000',
    shadowOpacity: 0.12,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 4,
  },
  tripChipText: { flexShrink: 1, fontSize: fontSize.sm, fontWeight: fontWeight.semibold, color: colors.text },
  paymentChip: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: spacing.sm + 2, minHeight: 36,
    borderRadius: radius.pill, backgroundColor: colors.surface },
  paymentChipText: { fontSize: fontSize.sm, fontWeight: fontWeight.semibold, color: colors.text },
  backButton: {
    width: 48,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    shadowColor: '#000',
    shadowOpacity: 0.15,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 5,
  },

  sheetAvoider: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    justifyContent: 'flex-end',
  },

  sheet: {
    width: '100%',
    maxHeight: '64%',
    backgroundColor: colors.background,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    shadowColor: '#000',
    shadowOpacity: 0.12,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: -3 },
    elevation: 12,
  },
  sheetContent: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: spacing.md,
    gap: spacing.md,
  },
  sheetHandle: {
    width: 40,
    height: 4,
    borderRadius: radius.pill,
    backgroundColor: colors.border,
    alignSelf: 'center',
    marginBottom: spacing.xs,
  },

  statusRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  statusIcon: {
    width: 52,
    height: 52,
    borderRadius: radius.pill,
    backgroundColor: colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  statusIconError: { backgroundColor: colors.dangerSoft },
  statusText: { flex: 1, gap: 2 },
  statusTitle: { fontSize: fontSize.xl, fontWeight: fontWeight.bold, color: colors.text },
  offlineTitle: { color: colors.danger },
  statusSubtitle: { fontSize: fontSize.sm, color: colors.textSecondary },

  offerCard: { gap: spacing.sm + 4, padding: spacing.md, borderRadius: radius.lg, backgroundColor: colors.surfaceMuted },
  offerRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  offerAmount: { flex: 1, minWidth: 0, gap: 2 },
  bidTitle: { fontSize: fontSize.xs, fontWeight: fontWeight.medium, color: colors.textSecondary },
  fareInputWrap: { flexDirection: 'row', alignItems: 'baseline', gap: spacing.xs },
  fareCurrency: { color: colors.text, fontSize: fontSize.xl, fontWeight: fontWeight.bold },
  fareAmountInput: {
    flex: 1,
    minWidth: 0,
    minHeight: 48,
    paddingVertical: 0,
    color: colors.text,
    fontSize: fontSize.xxl,
    fontWeight: fontWeight.bold,
  },
  fareStepButton: {
    width: 48,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.controlBorder,
  },
  raiseHint: { fontSize: fontSize.sm, color: colors.textSecondary },
  raiseRow: { flexDirection: 'row', gap: spacing.sm },
  raiseButton: {
    flex: 1,
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.controlBorder,
  },
  raiseText: { fontSize: fontSize.md, fontWeight: fontWeight.semibold, color: colors.text },

  progressTrack: {
    height: 6,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceMuted,
    overflow: 'hidden',
    marginTop: spacing.xs,
  },
  progressBar: { width: '40%', height: '100%', borderRadius: radius.pill, backgroundColor: colors.primary },
  actionsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  modify: {
    flexGrow: 1,
    flexBasis: 140,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    minHeight: 48,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.controlBorder,
  },
  modifyText: { fontSize: fontSize.md, fontWeight: fontWeight.semibold, color: colors.text },
  cancel: {
    flexGrow: 1,
    flexBasis: 140,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 48,
    paddingHorizontal: spacing.sm,
  },
  cancelText: { textAlign: 'center', fontSize: fontSize.md, fontWeight: fontWeight.semibold, color: colors.danger },
  disabled: { opacity: 0.5 },
  error: { color: colors.danger, fontSize: fontSize.sm, textAlign: 'center' },
});
