import { formatBolivianos } from '@/features/rides/domain/money';
import { TripProgress } from '@/features/rides/presentation/TripProgress';
/**
 * Live offers (passenger).
 *
 * Background map with the route and, on top, the cards of
 * the drivers who made offers. The passenger **decides**: tapping Accept
 * assigns them the ride (atomic transaction in the backend) and a
 * confirmation overlay is shown before moving to the ride in progress. They can **reject** offers,
 * **modify** the request (pauses it in the pool and opens the edit) and **cancel**
 * (the only two ways out of the negotiation).
 *
 * The request does not expire over time; each offer lives 30 s (`expiresAt`) with its
 * own countdown per card. While no offers arrive, the searching
 * screen is shown.
 */
import { Ionicons } from '@react-native-vector-icons/ionicons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useReducedMotion } from 'react-native-reanimated';

import { getApiErrorMessage, getApiErrorStatus } from '@/core/errors/apiError';
import { useBlockHardwareBack } from '@/core/navigation/useBlockHardwareBack';
import { controls, fontSize, fontWeight, radius, spacing, useThemedStyles, type Theme } from '@/core/theme';
import { useBookingStore } from '@/features/booking/application/useBookingStore';
import { ConfirmationOverlay } from '@/features/booking/presentation/ConfirmationOverlay';
import { SearchingDriversScreen } from '@/features/booking/presentation/SearchingDriversScreen';
import { OfferCard } from '@/features/booking/presentation/TarjetaOferta';
import {
  useAcceptOffer,
  useCancelRide,
  usePauseForEdit,
  useRejectOffer,
} from '@/features/rides/application/useRideMutations';
import { useRide, useRideOffers } from '@/features/rides/application/useRides';
import { deriveOfferTags, primaryTag } from '@/features/rides/domain/offerTags';
import { orderOffers, type OfferOrder } from '@/features/rides/domain/offerComparison';
import type { Offer } from '@/features/rides/domain/types';
import { TripRouteMap } from '@/features/rides/presentation/TripRouteMap';
import { TripSecondaryAction } from '@/features/rides/presentation/TripSecondaryAction';
import { Button, ConfirmDialog, FeedbackState } from '@/shared/components';

export function OffersScreen() {
  const { colors, styles } = useThemedStyles(createStyles);
  const router = useRouter();
  const { rideId } = useLocalSearchParams<{ rideId?: string }>();
  const id = rideId ?? null;

  const origin = useBookingStore((s) => s.origin);
  const destination = useBookingStore((s) => s.destination);
  const service = useBookingStore((s) => s.service);
  const fare = useBookingStore((s) => s.fare);

  const rideQuery = useRide(id);
  const { ride } = rideQuery;
  // After restarting the app the booking Zustand is empty; the persisted ride
  // is the source of truth to rebuild the map and summary.
  const displayOrigin = ride?.origin ?? origin;
  const displayDestination = ride?.destination ?? destination;
  // It only counts as assigned if there is a real driver; when cancelling, the ride becomes
  // 'cancelled' and must NOT lead to the trip screen (it would end up showing
  // "Viaje cancelado"). The cancel handler already sends the user home directly.
  const assigned = !!ride && ride.status !== 'searching' && ride.status !== 'cancelled';
  const cancelled = ride?.status === 'cancelled';
  useBlockHardwareBack(Boolean(ride) && !cancelled);
  const offersQuery = useRideOffers(id, !assigned && !cancelled);
  const { offers } = offersQuery;
  const acceptOffer = useAcceptOffer();
  const rejectOffer = useRejectOffer();
  const cancelRide = useCancelRide();
  const pauseForEdit = usePauseForEdit();

  // Local dismissals: cards the passenger removed from their screen.
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  // Tick every second so expired offers disappear on their own.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const visibleOffers = useMemo(
    () =>
      offers.filter(
        (o) =>
          !dismissed.has(o.id) &&
          (o.expiresAt == null || new Date(o.expiresAt).getTime() > now),
      ),
    [offers, dismissed, now],
  );

  // Client-side derived tags (ECONÓMICO / RÁPIDO / FAVORITO).
  const tagsMap = useMemo(() => deriveOfferTags(visibleOffers), [visibleOffers]);
  const [offerOrder, setOfferOrder] = useState<OfferOrder>('recent');
  const orderedOffers = useMemo(() => orderOffers(visibleOffers, offerOrder), [visibleOffers, offerOrder]);

  const [confirming, setConfirming] = useState(false);
  const [offerToAccept, setOfferToAccept] = useState<Offer | null>(null);
  const acceptingRef = useRef(false);
  const [sheetHeight, setSheetHeight] = useState(500);
  const activeOfferToAccept = offerToAccept
    ? visibleOffers.find((offer) => offer.id === offerToAccept.id) ?? null : null;
  // Set before firing the HTTP request. The backend publishes `ride_status`
  // accepted before responding, so this intent keeps that event from
  // navigating to Trip and unmounting the local confirmation too early.
  const [acceptIntent, setAcceptIntent] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [offerToReject, setOfferToReject] = useState<Offer | null>(null);
  const [returningHome, setReturningHome] = useState(false);
  const [editTarget, setEditTarget] = useState<{ rideId?: string } | null>(null);
  const returningHomeRef = useRef(false);
  const editingRef = useRef(false);
  const confirmationVisible = confirming || (assigned && acceptIntent);
  const activeOfferToReject =
    offerToReject && visibleOffers.some((offer) => offer.id === offerToReject.id)
      ? offerToReject
      : null;

  const beginReturnHome = useCallback(() => {
    if (returningHomeRef.current) return;
    returningHomeRef.current = true;
    useBookingStore.getState().resetTrip();
    setReturningHome(true);
  }, []);

  const beginEdit = useCallback((targetRideId?: string) => {
    if (editingRef.current) return;
    editingRef.current = true;
    setEditTarget({ rideId: targetRideId });
  }, []);

  // First unmount the map, markers and dialogs. On the next frame go back
  // to the Tabs that already exist underneath, avoiding two overlapping native trees.
  useEffect(() => {
    if (!returningHome) return;
    const frame = requestAnimationFrame(() => router.dismissTo('/(app)/(tabs)'));
    return () => cancelAnimationFrame(frame);
  }, [returningHome, router]);

  // Fabric processes native changes per frame. Unmounting the map first and
  // navigating two frames later keeps react-native-maps from reusing a view
  // that Android still considers a child of the previous tree.
  useEffect(() => {
    if (!editTarget) return;

    let navigationFrame: number | null = null;
    const teardownFrame = requestAnimationFrame(() => {
      navigationFrame = requestAnimationFrame(() => {
        if (editTarget.rideId) {
          router.replace({
            pathname: '/booking/configure',
            params: { rideId: editTarget.rideId },
          });
        } else {
          router.replace('/booking/configure');
        }
      });
    });

    return () => {
      cancelAnimationFrame(teardownFrame);
      if (navigationFrame != null) cancelAnimationFrame(navigationFrame);
    };
  }, [editTarget, router]);

  // Backup: if the ride gets assigned another way (e.g. WS), go to the ride.
  useEffect(() => {
    if (assigned && id && !confirmationVisible) {
      router.replace({ pathname: '/booking/trip', params: { rideId: id } });
    }
  }, [assigned, id, confirmationVisible, router]);

  // This is the only exit authority, both for a local cancellation and for
  // an event received from another device. The ref prevents navigating twice.
  useEffect(() => {
    if (!cancelled || cancelRide.isPending || confirmationVisible) return;
    beginReturnHome();
  }, [beginReturnHome, cancelled, cancelRide.isPending, confirmationVisible]);

  const onAccept = (offer: Offer) => {
    if (!id || acceptOffer.isPending || acceptingRef.current
      || (offer.expiresAt != null && Date.parse(offer.expiresAt) <= Date.now())) return;
    acceptingRef.current = true;
    setAcceptIntent(true);
    // Accepting assigns the ride (final decision): we show the overlay on confirm.
    acceptOffer.mutate({ offerId: offer.id, rideId: id }, {
      onSettled: () => { acceptingRef.current = false; },
      onSuccess: (savedRide) => {
        setConfirming(savedRide.status === 'accepted');
        setAcceptIntent(false);
      },
      onError: (error) => {
        setAcceptIntent(false);
        // The offer died on the way (expired/withdrawn/taken by someone else): we remove it.
        if (getApiErrorStatus(error) === 409) {
          setDismissed((prev) => new Set(prev).add(offer.id));
        }
      },
    });
  };

  const handleConfirmed = () => {
    setConfirming(false);
    if (id) router.replace({ pathname: '/booking/trip', params: { rideId: id } });
  };

  const rejectConfirmed = (offer: Offer) => {
    if (acceptOffer.isPending || rejectOffer.isPending) return;
    setDismissed((prev) => new Set(prev).add(offer.id));
    if (!id) return;

    rejectOffer.mutate(
      { offerId: offer.id, rideId: id },
      {
        onError: () => {
          setDismissed((prev) => {
            const next = new Set(prev);
            next.delete(offer.id);
            return next;
          });
        },
      },
    );
  };

  const onModify = () => {
    if (
      acceptOffer.isPending ||
      rejectOffer.isPending ||
      pauseForEdit.isPending ||
      cancelRide.isPending ||
      !id
    ) return;
    // Pause the request (hide it from the pool) and open the edit without cancelling.
    pauseForEdit.mutate(id, {
      onSuccess: () => beginEdit(id),
    });
  };

  const cancelRequest = () => {
    if (
      acceptOffer.isPending ||
      rejectOffer.isPending ||
      pauseForEdit.isPending ||
      cancelRide.isPending
    ) return;
    if (!id) {
      beginReturnHome();
      return;
    }
    // Reset the store only once the backend confirms: if the network fails, the
    // user stays on the screen with the error (no orphaned ride).
    cancelRide.mutate(id, {
      onSuccess: beginReturnHome,
    });
  };

  const onCancel = () => {
    setConfirmCancel(false);
    cancelRequest();
  };

  // Only the chosen offer shows progress; decisions are locked
  // while any of the negotiation operations finishes.
  const acceptingId = acceptOffer.isPending ? acceptOffer.variables?.offerId ?? null : null;
  const negotiationBusy =
    acceptOffer.isPending ||
    rejectOffer.isPending ||
    pauseForEdit.isPending ||
    cancelRide.isPending ||
    editTarget != null;

  if (returningHome || editTarget) return <View style={styles.root} />;

  if (!id || (!ride && rideQuery.isError)) {
    return (
      <SafeAreaView style={styles.root}>
        <FeedbackState
          title={id ? 'No pudimos cargar tu solicitud' : 'La solicitud no es válida'}
          message={id ? getApiErrorMessage(rideQuery.error) : undefined}
          actionLabel={id ? 'Reintentar' : undefined}
          onAction={id ? () => void rideQuery.refetch() : undefined}
        />
        <Button title="Volver al inicio" variant="secondary" onPress={beginReturnHome} />
      </SafeAreaView>
    );
  }

  if (assigned && !confirmationVisible) {
    // The ride was assigned: the overlay already navigated, or this is the fallback.
    return null;
  }

  // While the confirmation overlay is active we do NOT switch to the searching
  // screen: if the accepted offer (the only visible one) expires at that moment,
  // unmounting the overlay would leave `confirming` hanging and the passenger stuck.
  if (visibleOffers.length === 0 && !confirmationVisible && offerToAccept == null) {
    return (
      <SearchingDriversScreen
        service={ride?.service ?? service}
        rideId={id}
        origin={displayOrigin}
        destination={displayDestination}
        currentFare={ride?.fare ?? (fare ? Number(fare.replace(',', '.')) : null)}
        connectionError={rideQuery.error ?? offersQuery.error}
        cancelPending={cancelRide.isPending}
        cancelError={cancelRide.isError ? cancelRide.error : undefined}
        onCancelRequest={cancelRequest}
        onEditReady={beginEdit}
        onRetry={() => {
          void rideQuery.refetch();
          void offersQuery.refetch();
        }}
      />
    );
  }

  return (
    <View style={styles.root}>
      {displayOrigin && displayDestination ? (
        <TripRouteMap
          service={ride?.service ?? service}
          origin={displayOrigin}
          destination={displayDestination}
          topPadding={48}
          bottomPadding={sheetHeight}
        />
      ) : (
        <View style={styles.mapFallback} />
      )}

      <View style={styles.overlay} onLayout={(event) => setSheetHeight(event.nativeEvent.layout.height)}>
        <ScrollView
          style={styles.list}
          contentContainerStyle={styles.listContent} bounces={false}>
          <View style={styles.liveHeader} pointerEvents="none">
            <TripProgress status="searching" />
            <View style={styles.liveTitleRow}>
              <Text style={styles.liveTitle}>Ofertas en vivo</Text>
              <LiveDot />
            </View>
            <Text style={styles.liveSubtitle}>
              {visibleOffers.length}{' '}
              {visibleOffers.length === 1 ? 'oferta disponible' : 'ofertas disponibles'}
            </Text>
            <Text style={styles.liveSubtitle}>Tú eliges. Cada oferta vence en 30 segundos.</Text>
          </View>
          <OfferOrderControl value={offerOrder} onChange={setOfferOrder} />
          {(rideQuery.isError || offersQuery.isError) && (
            <TouchableOpacity
              style={styles.connectionWarning}
              onPress={() => {
                void rideQuery.refetch();
                void offersQuery.refetch();
              }}
              accessibilityRole="button"
              accessibilityLabel="Reintentar actualización de ofertas">
              <Ionicons name="cloud-offline-outline" size={18} color={colors.danger} />
              <Text style={styles.connectionWarningText}>
                No pudimos actualizar las ofertas. Toca para reintentar.
              </Text>
              <Ionicons name="refresh" size={18} color={colors.primary} />
            </TouchableOpacity>
          )}
          {(acceptOffer.isError || rejectOffer.isError) && (
            <Text style={styles.error}>
              {getApiErrorMessage(
                acceptOffer.isError ? acceptOffer.error : rejectOffer.error,
              )}
            </Text>
          )}
          {orderedOffers.map((offer) => (
            <OfferCard
              key={offer.id}
              offer={offer}
              tag={primaryTag(tagsMap[offer.id])}
              now={now}
              acceptingId={acceptingId}
              decisionsLocked={negotiationBusy}
              onAccept={() => setOfferToAccept(offer)}
              onReject={() => setOfferToReject(offer)}
            />
          ))}
        </ScrollView>

      <SafeAreaView edges={['bottom']} style={styles.actionsSheet}>
        {pauseForEdit.isError && (
          <Text style={styles.error}>{getApiErrorMessage(pauseForEdit.error)}</Text>
        )}
        {cancelRide.isError && (
          <Text style={styles.error}>{getApiErrorMessage(cancelRide.error)}</Text>
        )}
        <Button
          title="Modificar solicitud"
          variant="secondary"
          leadingIcon="create-outline"
          loading={pauseForEdit.isPending}
          loadingLabel="Abriendo solicitud…"
          onPress={onModify}
          disabled={negotiationBusy || !id}
        />
        <TripSecondaryAction
          title={cancelRide.isPending ? 'Cancelando…' : 'Cancelar solicitud'}
          onPress={() => setConfirmCancel(true)}
          disabled={negotiationBusy}
        />
      </SafeAreaView>
      </View>

      <ConfirmationOverlay visible={confirmationVisible} onDone={handleConfirmed} />

      <ConfirmDialog visible={offerToAccept != null && !negotiationBusy}
        icon="car-sport-outline" title={activeOfferToAccept ? 'Confirma tu conductor' : 'Oferta no disponible'}
        message={activeOfferToAccept
          ? `${activeOfferToAccept.driver.fullName} · Bs ${formatBolivianos(activeOfferToAccept.price)}. `
            + (activeOfferToAccept.etaMin != null ? `Llegada estimada: ${activeOfferToAccept.etaMin} min. ` : '')
            + [activeOfferToAccept.driver.vehicleModel, activeOfferToAccept.driver.plate].filter(Boolean).join(' · ')
            + '. Al confirmar, este conductor irá a recogerte.'
          : 'La oferta venció o fue retirada. Puedes comparar las ofertas vigentes o seguir buscando.'}
        confirmText={activeOfferToAccept ? 'Confirmar conductor' : 'Ver ofertas'} cancelText="Comparar ofertas"
        onConfirm={() => {
          const offer = activeOfferToAccept;
          setOfferToAccept(null);
          if (offer) onAccept(offer);
        }}
        onCancel={() => setOfferToAccept(null)} />

      <ConfirmDialog
        visible={confirmCancel}
        icon="warning"
        destructive
        title="¿Cancelar solicitud?"
        message="Si cancelas, perderás las ofertas de los conductores que ya están evaluando tu viaje y volverás a empezar."
        confirmText="Sí, cancelar"
        cancelText="Seguir negociando"
        onConfirm={onCancel}
        onCancel={() => setConfirmCancel(false)}
      />

      <ConfirmDialog
        visible={activeOfferToReject != null}
        icon="remove-circle-outline"
        title="¿Descartar esta oferta?"
        message={
          activeOfferToReject
            ? `La oferta de ${activeOfferToReject.driver.fullName} dejará de aparecer en tu negociación.`
            : undefined
        }
        confirmText="Descartar oferta"
        cancelText="Conservar"
        onConfirm={() => {
          const offer = activeOfferToReject;
          setOfferToReject(null);
          if (offer) rejectConfirmed(offer);
        }}
        onCancel={() => setOfferToReject(null)}
      />
    </View>
  );
}

function OfferOrderControl({ value, onChange }: { value: OfferOrder; onChange: (order: OfferOrder) => void }) {
  const { styles, focusStyle } = useThemedStyles(createStyles);
  const [focused, setFocused] = useState<OfferOrder | null>(null);
  const choices: { value: OfferOrder; label: string; description: string }[] = [
    { value: 'recent', label: 'Recientes', description: 'Ofertas más recientes primero' },
    { value: 'price', label: 'Precio', description: 'Ofertas de menor precio primero' },
    { value: 'arrival', label: 'Llegada', description: 'Ofertas de menor tiempo de llegada primero' },
  ];
  return <View style={styles.orderControl} accessibilityRole="tablist" accessibilityLabel="Ordenar ofertas">
    {choices.map(choice => <TouchableOpacity key={choice.value} accessibilityRole="tab"
      accessibilityLabel={choice.description} accessibilityState={{ selected: value === choice.value }}
      onPress={() => onChange(choice.value)} onFocus={() => setFocused(choice.value)} onBlur={() => setFocused(null)}
      style={[styles.orderButton, value === choice.value && styles.orderSelected, focused === choice.value && focusStyle]}>
      {value === choice.value && <Ionicons accessible={false} name="checkmark" size={16} color={styles.orderSelectedLabel.color} />}
      <Text style={[styles.orderLabel, value === choice.value && styles.orderSelectedLabel]}>{choice.label}</Text>
    </TouchableOpacity>)}
  </View>;
}

/** Punto verde que late: indicador "en vivo". */
function LiveDot() {
  const { styles } = useThemedStyles(createStyles);
  const reduceMotion = useReducedMotion();
  const [value] = useState(() => new Animated.Value(0));
  useEffect(() => {
    if (reduceMotion) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(value, {
          toValue: 1,
          duration: 900,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(value, {
          toValue: 0,
          duration: 900,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [value, reduceMotion]);
  return (
    <Animated.View
      accessible={false}
      style={[styles.liveDot, { opacity: reduceMotion ? 1 : value.interpolate({ inputRange: [0, 1], outputRange: [1, 0.35] }) }]}
    />
  );
}

const createStyles = ({ colors }: Theme) => StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surfaceMuted },
  mapFallback: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: colors.surfaceMuted },

  overlay: { position: 'absolute', bottom: 0, left: 0, right: 0, height: '64%',
    backgroundColor: colors.background, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg,
    paddingTop: spacing.sm, overflow: 'hidden' },
  orderControl: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs,
    padding: spacing.xs, borderRadius: radius.md, backgroundColor: colors.surfaceMuted },
  orderButton: { minHeight: controls.minHeight, flexDirection: 'row', gap: spacing.xs,
    flexBasis: 80, flexGrow: 1, justifyContent: 'center', alignItems: 'center',
    paddingHorizontal: spacing.sm, paddingVertical: spacing.xs, borderRadius: radius.sm },
  orderSelected: { backgroundColor: colors.primary },
  orderLabel: { flexShrink: 1, fontSize: fontSize.sm, fontWeight: fontWeight.medium, color: colors.textSecondary },
  orderSelectedLabel: { color: colors.textOnPrimary },

  // Opaque header to keep it readable over the map.
  liveHeader: { paddingVertical: spacing.xs },
  liveTitleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  liveTitle: { flexShrink: 1, fontSize: fontSize.lg, fontWeight: fontWeight.bold, color: colors.text },
  liveDot: { width: 8, height: 8, borderRadius: radius.pill, backgroundColor: colors.success },
  liveSubtitle: { fontSize: fontSize.sm, color: colors.textSecondary, marginTop: 2 },

  // Lista de tarjetas.
  list: { flex: 1 },
  listContent: { paddingHorizontal: spacing.md, gap: spacing.sm, paddingBottom: spacing.md },
  connectionWarning: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.dangerBorder,
    backgroundColor: colors.surface,
  },
  connectionWarningText: {
    flex: 1,
    fontSize: fontSize.sm,
    color: colors.text,
  },
  listBottomSpacer: { height: spacing.md },

  actionsSheet: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    gap: spacing.xs,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },

  error: { color: colors.danger, fontSize: fontSize.sm, textAlign: 'center' },
});
