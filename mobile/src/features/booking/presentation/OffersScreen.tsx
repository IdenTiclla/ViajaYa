/**
 * Ofertas en vivo (pasajero) — diseño Material-You "Ofertas en Vivo".
 *
 * Mapa de fondo con el trayecto y, superpuestas, las tarjetas translúcidas de
 * los conductores que ofertaron. El pasajero **decide**: al pulsar Aceptar se le
 * asigna el viaje (transacción atómica en el backend) y se muestra un overlay de
 * confirmación antes de pasar al viaje en curso. Puede **rechazar** ofertas o
 * **modificar** la solicitud (la pausa del pool y abre la edición) y **cancelar**
 * (las únicas dos formas de salir de la negociación).
 *
 * La solicitud no caduca por tiempo; cada oferta vive 30 s (`expiresAt`) con su
 * propio contador por tarjeta. Mientras no llegan ofertas se muestra la pantalla
 * de búsqueda.
 */
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
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

import { getApiErrorMessage, getApiErrorStatus } from '@/core/errors/apiError';
import { colors, fontSize, fontWeight, radius, spacing } from '@/core/theme';
import { useBookingStore } from '@/features/booking/application/useBookingStore';
import { ConfirmationOverlay } from '@/features/booking/presentation/ConfirmationOverlay';
import { SearchingDriversScreen } from '@/features/booking/presentation/SearchingDriversScreen';
import {
  useAcceptOffer,
  useCancelRide,
  usePauseForEdit,
  useRejectOffer,
} from '@/features/rides/application/useRideMutations';
import { useRide, useRideOffers } from '@/features/rides/application/useRides';
import { formatBolivianos } from '@/features/rides/domain/money';
import { deriveOfferTags, primaryTag, type OfferTagKind } from '@/features/rides/domain/offerTags';
import type { Offer } from '@/features/rides/domain/types';
import { OfferLifeTimer } from '@/features/rides/presentation/OfferLifeTimer';
import { TripRouteMap } from '@/features/rides/presentation/TripRouteMap';
import { RouteSummary } from '@/features/rides/presentation/RouteSummary';
import { ConfirmDialog } from '@/shared/components';

const SERVICE_LABELS = { taxi: 'Taxi', moto: 'Moto' } as const;

/** Color + ícono por tipo de tag (ECONÓMICO / RÁPIDO / FAVORITO). */
const TAG_META: Record<OfferTagKind, { icon: keyof typeof Ionicons.glyphMap; color: string; bg: string }> = {
  cheapest: { icon: 'pricetag', color: colors.success, bg: 'rgba(15,157,88,0.12)' },
  fastest: { icon: 'flash', color: '#B07A00', bg: 'rgba(245,197,24,0.18)' },
  bestRated: { icon: 'star', color: colors.primary, bg: 'rgba(22,48,140,0.10)' },
};

export function OffersScreen() {
  const router = useRouter();
  const { rideId } = useLocalSearchParams<{ rideId?: string }>();
  const id = rideId ?? null;

  const origin = useBookingStore((s) => s.origin);
  const destination = useBookingStore((s) => s.destination);
  const fare = useBookingStore((s) => s.fare);

  const rideQuery = useRide(id);
  const { ride } = rideQuery;
  // Tras reiniciar la app el Zustand de booking esta vacio; el viaje persistido
  // es la fuente de verdad para reconstruir mapa y resumen.
  const displayOrigin = ride?.origin ?? origin;
  const displayDestination = ride?.destination ?? destination;
  // Solo cuenta como asignado si hay conductor real; al cancelar, el viaje pasa
  // a 'cancelled' y NO debe llevar a la pantalla de viaje (vendría a mostrar
  // "Viaje cancelado"). El handler de cancelar ya envía al inicio directamente.
  const assigned = !!ride && ride.status !== 'searching' && ride.status !== 'cancelled';
  const cancelled = ride?.status === 'cancelled';
  const offersQuery = useRideOffers(id, !assigned && !cancelled);
  const { offers } = offersQuery;
  const acceptOffer = useAcceptOffer();
  const rejectOffer = useRejectOffer();
  const cancelRide = useCancelRide();
  const pauseForEdit = usePauseForEdit();

  // Descartes locales: tarjetas que el pasajero quitó de su pantalla.
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  // Tick por segundo para que las ofertas vencidas desaparezcan solas.
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

  // Tags derivados client-side (ECONÓMICO / RÁPIDO / FAVORITO).
  const tagsMap = useMemo(() => deriveOfferTags(visibleOffers), [visibleOffers]);

  const [confirming, setConfirming] = useState(false);
  // Se activa antes de disparar el HTTP. El backend publica `ride_status`
  // accepted antes de responder, asi que esta intencion evita que ese evento
  // navegue a Trip y desmonte la confirmacion local prematuramente.
  const [acceptIntent, setAcceptIntent] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const confirmationVisible = confirming || (assigned && acceptIntent);

  // Backup: si el viaje queda asignado por otra vía (p. ej. WS), ir al viaje.
  useEffect(() => {
    if (assigned && id && !confirmationVisible) {
      router.replace({ pathname: '/booking/trip', params: { rideId: id } });
    }
  }, [assigned, id, confirmationVisible, router]);

  // El viaje se canceló sin que esta pantalla lo iniciara (otro dispositivo,
  // sesión previa): sin este efecto el pasajero quedaría "buscando" un viaje
  // muerto. El cancel local también pasa por aquí sin daño (replace idempotente).
  useEffect(() => {
    if (!cancelled || cancelRide.isPending || confirmationVisible) return;
    useBookingStore.getState().resetTrip();
    router.replace('/(app)/(tabs)');
  }, [cancelled, cancelRide.isPending, confirmationVisible, router]);

  const onAccept = (offer: Offer) => {
    if (acceptOffer.isPending) return;
    setAcceptIntent(true);
    // Aceptar asigna el viaje (decisión final): mostramos el overlay al confirmar.
    acceptOffer.mutate(offer.id, {
      onSuccess: () => {
        setConfirming(true);
        setAcceptIntent(false);
      },
      onError: (error) => {
        setAcceptIntent(false);
        // La oferta murió en el camino (expiró/retirada/otro la tomó): la quitamos.
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

  const onReject = (offer: Offer) => {
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
    if (pauseForEdit.isPending || !id) return;
    // Pausa la solicitud (la oculta del pool) y abre la edición sin cancelar.
    pauseForEdit.mutate(id, {
      onSuccess: () =>
        router.replace({ pathname: '/booking/configure', params: { rideId: id } }),
    });
  };

  const onCancel = () => {
    setConfirmCancel(false);
    if (cancelRide.isPending) return;
    if (!id) {
      useBookingStore.getState().resetTrip();
      router.replace('/(app)/(tabs)');
      return;
    }
    // Resetea el store recién cuando el backend confirma: si la red falla, el
    // usuario se queda en la pantalla con el error (sin ride huérfano).
    cancelRide.mutate(id, {
      onSuccess: () => {
        useBookingStore.getState().resetTrip();
        router.replace('/(app)/(tabs)');
      },
    });
  };

  // Oferta cuyo Aceptar está en curso: solo esa tarjeta se bloquea (las demás
  // siguen permitiendo Rechazar, que es ortogonal).
  const acceptingId = acceptOffer.isPending ? acceptOffer.variables ?? null : null;

  if (assigned && !confirmationVisible) {
    // El viaje quedó asignado: el overlay ya navegó, o este es el respaldo.
    return null;
  }

  // Mientras el overlay de confirmación está activo NO se cambia a la pantalla
  // de búsqueda: si la oferta aceptada (única visible) expira en ese instante,
  // desmontar el overlay dejaría `confirming` colgado y al pasajero sin navegar.
  if (visibleOffers.length === 0 && !confirmationVisible) {
    return (
      <SearchingDriversScreen
        rideId={id}
        origin={displayOrigin}
        destination={displayDestination}
        currentFare={ride?.fare ?? (fare ? Number(fare.replace(',', '.')) : null)}
        connectionError={rideQuery.error ?? offersQuery.error}
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
          origin={displayOrigin}
          destination={displayDestination}
          topPadding={170}
          bottomPadding={170}
        />
      ) : (
        <View style={styles.mapFallback} />
      )}

      <SafeAreaView edges={['top']} style={styles.overlay} pointerEvents="box-none">
        {/* Resumen de ruta (informativo) */}
        <View style={styles.routeWrap} pointerEvents="none">
          <RouteSummary
            origin={displayOrigin ?? { name: '—' }}
            destination={displayDestination ?? { name: '—' }}
          />
        </View>

        {/* Sección "Ofertas en vivo" — sobre tarjeta glass para que se lea sobre el mapa */}
        <View style={styles.liveHeader} pointerEvents="none">
          <View style={styles.liveTitleRow}>
            <Text style={styles.liveTitle}>Ofertas en vivo</Text>
            <LiveDot />
          </View>
          <Text style={styles.liveSubtitle}>
            {visibleOffers.length}{' '}
            {visibleOffers.length === 1 ? 'conductor cerca' : 'conductores cerca'}
          </Text>
        </View>

        <ScrollView
          style={styles.list}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}>
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
          {visibleOffers.map((offer) => (
            <OfferCard
              key={offer.id}
              offer={offer}
              tag={primaryTag(tagsMap[offer.id])}
              now={now}
              acceptingId={acceptingId}
              onAccept={() => onAccept(offer)}
              onReject={() => onReject(offer)}
            />
          ))}
          <View style={styles.listBottomSpacer} />
        </ScrollView>
      </SafeAreaView>

      {/* Acciones en bloques grandes, igual que al buscar ofertas */}
      <SafeAreaView edges={['bottom']} style={styles.actionsSheet}>
        {pauseForEdit.isError && (
          <Text style={styles.error}>{getApiErrorMessage(pauseForEdit.error)}</Text>
        )}
        {cancelRide.isError && (
          <Text style={styles.error}>{getApiErrorMessage(cancelRide.error)}</Text>
        )}
        <TouchableOpacity
          style={[styles.modify, pauseForEdit.isPending && styles.disabled]}
          onPress={onModify}
          disabled={pauseForEdit.isPending}
          accessibilityRole="button"
          accessibilityLabel="Modificar solicitud">
          <Ionicons name="create-outline" size={20} color={colors.primary} />
          <Text style={styles.modifyText}>Modificar solicitud</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.cancel, cancelRide.isPending && styles.disabled]}
          onPress={() => setConfirmCancel(true)}
          disabled={cancelRide.isPending}
          accessibilityRole="button"
          accessibilityLabel="Cancelar solicitud">
          <Ionicons name="close" size={18} color={colors.danger} />
          <Text style={styles.cancelText}>
            {cancelRide.isPending ? 'Cancelando…' : 'Cancelar solicitud'}
          </Text>
        </TouchableOpacity>
      </SafeAreaView>

      <ConfirmationOverlay visible={confirmationVisible} onDone={handleConfirmed} />

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
    </View>
  );
}

function OfferCard({
  offer,
  tag,
  now,
  acceptingId,
  onAccept,
  onReject,
}: {
  offer: Offer;
  tag: { kind: OfferTagKind; label: string; subLabel: string } | null;
  /** Tick global (segundo a segundo) compartido por todas las tarjetas. */
  now: number;
  /** Oferta cuyo Aceptar está en curso (solo esa se bloquea). */
  acceptingId: string | null;
  onAccept: () => void;
  onReject: () => void;
}) {
  const { driver } = offer;
  const expiresMs = offer.expiresAt ? new Date(offer.expiresAt).getTime() : null;
  const secondsLeft =
    expiresMs != null ? Math.max(0, Math.ceil((expiresMs - now) / 1000)) : null;
  const acceptInFlight = acceptingId === offer.id;
  const initial = driver.fullName.trim().charAt(0).toUpperCase() || 'C';
  const vehicle = [
    driver.vehicleType ? SERVICE_LABELS[driver.vehicleType] : null,
    driver.vehicleModel,
    driver.plate,
  ]
    .filter(Boolean)
    .join(' · ');
  const tagMeta = tag ? TAG_META[tag.kind] : null;

  return (
    <View style={styles.card}>
      <View style={styles.cardTop}>
        <View style={styles.avatarWrap}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{initial}</Text>
          </View>
          {driver.rating != null && (
            <View style={styles.ratingBadge}>
              <Text style={styles.ratingBadgeText}>{driver.rating.toFixed(1)}★</Text>
            </View>
          )}
        </View>
        <View style={styles.cardInfo}>
          <Text style={styles.driverName} numberOfLines={1}>
            {driver.fullName}
          </Text>
          {tag && (
            <View style={[styles.tagPill, { backgroundColor: tagMeta?.bg }]}>
              <Ionicons name={tagMeta?.icon ?? 'pricetag'} size={11} color={tagMeta?.color} />
              <Text style={[styles.tagText, { color: tagMeta?.color }]}>{tag.label}</Text>
            </View>
          )}
          {!!vehicle && (
            <Text style={styles.vehicle} numberOfLines={1}>
              {vehicle}
            </Text>
          )}
          <View style={styles.metaRow}>
            {offer.etaMin != null && (
              <View style={styles.eta}>
                <Ionicons name="time-outline" size={13} color={colors.primary} />
                <Text style={styles.etaText}>{offer.etaMin} min</Text>
              </View>
            )}
            <OfferLifeTimer secondsLeft={secondsLeft} />
          </View>
        </View>
        <View style={styles.priceCol}>
          <Text style={styles.price}>Bs {formatBolivianos(offer.price)}</Text>
          {tag && <Text style={styles.priceSub}>{tag.subLabel}</Text>}
        </View>
      </View>

      <View style={styles.cardActions}>
        <TouchableOpacity
          style={styles.rejectBtn}
          onPress={onReject}
          accessibilityRole="button"
          accessibilityLabel={`Rechazar oferta de ${driver.fullName}`}>
          <Text style={styles.rejectText}>Rechazar</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.acceptBtn, acceptInFlight && styles.disabled]}
          onPress={onAccept}
          disabled={acceptInFlight}
          accessibilityRole="button"
          accessibilityLabel={`Aceptar oferta de ${driver.fullName} por Bs ${formatBolivianos(offer.price)}`}>
          <Text style={styles.acceptText}>Aceptar</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

/** Punto verde que late: indicador "en vivo". */
function LiveDot() {
  const [value] = useState(() => new Animated.Value(0));
  useEffect(() => {
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
  }, [value]);
  return (
    <Animated.View
      style={[styles.liveDot, { opacity: value.interpolate({ inputRange: [0, 1], outputRange: [1, 0.35] }) }]}
    />
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surfaceMuted },
  mapFallback: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: colors.surfaceMuted },

  overlay: { flex: 1 },

  // Contenedor del resumen de ruta.
  routeWrap: { marginHorizontal: spacing.md, marginTop: spacing.sm, marginBottom: spacing.sm },

  // Sección "Ofertas en vivo" sobre tarjeta glass (legible sobre el mapa).
  liveHeader: {
    marginHorizontal: spacing.md,
    marginBottom: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    backgroundColor: 'rgba(255,255,255,0.92)',
    borderWidth: 1,
    borderColor: 'rgba(226,228,232,0.7)',
  },
  liveTitleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  liveTitle: { fontSize: fontSize.lg, fontWeight: fontWeight.bold, color: colors.text },
  liveDot: { width: 8, height: 8, borderRadius: radius.pill, backgroundColor: colors.success },
  liveSubtitle: { fontSize: fontSize.sm, color: colors.textSecondary, marginTop: 2 },

  // Lista de tarjetas.
  list: { flex: 1 },
  listContent: { paddingHorizontal: spacing.md, gap: spacing.md, paddingBottom: spacing.lg },
  connectionWarning: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: 'rgba(217,45,32,0.28)',
    backgroundColor: 'rgba(255,255,255,0.96)',
  },
  connectionWarningText: {
    flex: 1,
    fontSize: fontSize.sm,
    color: colors.text,
  },
  listBottomSpacer: { height: spacing.md },

  // Contenedor de acciones (sin hoja): bloques grandes directamente sobre el mapa.
  actionsSheet: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    paddingBottom: spacing.sm,
    gap: spacing.sm,
  },
  modify: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    height: 52,
    borderRadius: radius.md,
    borderWidth: 2,
    borderColor: colors.primary,
    backgroundColor: colors.surface,
  },
  modifyText: { fontSize: fontSize.md, fontWeight: fontWeight.semibold, color: colors.primary },
  cancel: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    height: 48,
    borderRadius: radius.md,
    backgroundColor: '#FDECEA',
    borderWidth: 1,
    borderColor: '#F5C6C2',
  },
  cancelText: { fontSize: fontSize.md, fontWeight: fontWeight.semibold, color: colors.danger },

  // Tarjeta translúcida (glassmorphism con rgba + sombra).
  card: {
    padding: spacing.md,
    gap: spacing.md,
    borderRadius: radius.lg,
    backgroundColor: 'rgba(255,255,255,0.92)',
    borderWidth: 1,
    borderColor: 'rgba(226,228,232,0.7)',
    shadowColor: '#000',
    shadowOpacity: 0.12,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
  cardTop: { flexDirection: 'row', gap: spacing.md },
  avatarWrap: { width: 52, height: 52 },
  avatar: {
    width: 52,
    height: 52,
    borderRadius: radius.pill,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { color: colors.textOnPrimary, fontSize: fontSize.lg, fontWeight: fontWeight.bold },
  ratingBadge: {
    position: 'absolute',
    bottom: -4,
    right: -6,
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: radius.pill,
    backgroundColor: colors.accent,
    borderWidth: 2,
    borderColor: colors.surface,
  },
  ratingBadgeText: { color: '#5A4500', fontSize: 10, fontWeight: fontWeight.bold },

  cardInfo: { flex: 1, gap: 3 },
  driverName: { fontSize: fontSize.md, fontWeight: fontWeight.bold, color: colors.text },
  tagPill: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: spacing.xs + 2,
    paddingVertical: 2,
    borderRadius: radius.pill,
  },
  tagText: { fontSize: 10, fontWeight: fontWeight.bold, letterSpacing: 0.3 },
  vehicle: { fontSize: fontSize.sm, color: colors.textSecondary },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: 2, flexWrap: 'wrap' },
  eta: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  etaText: { fontSize: fontSize.sm, color: colors.primary, fontWeight: fontWeight.semibold },

  priceCol: { alignItems: 'flex-end', justifyContent: 'center' },
  price: { fontSize: fontSize.xl, fontWeight: fontWeight.bold, color: colors.primary },
  priceSub: { fontSize: 10, color: colors.textSecondary, fontWeight: fontWeight.semibold, marginTop: 2 },

  cardActions: { flexDirection: 'row', gap: spacing.sm },
  rejectBtn: {
    flex: 1,
    height: 48,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(242,243,245,0.8)',
    borderWidth: 1,
    borderColor: colors.border,
  },
  rejectText: { fontSize: fontSize.md, fontWeight: fontWeight.bold, color: colors.text },
  acceptBtn: {
    flex: 1.5,
    height: 48,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primary,
  },
  acceptText: { fontSize: fontSize.md, fontWeight: fontWeight.bold, color: colors.textOnPrimary },
  disabled: { opacity: 0.5 },

  error: { color: colors.danger, fontSize: fontSize.sm, textAlign: 'center' },
});
