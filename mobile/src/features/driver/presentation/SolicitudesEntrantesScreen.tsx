/**
 * Solicitudes entrantes (conductor) — diseño Material-You.
 *
 * Tres estados: viaje activo → seguimiento; sin solicitudes → "Buscando viajes"
 * (mapa + radar + hoja con rendimiento del día); con solicitudes → cabecera glass
 * + toggle Lista/Mapa y tarjetas translúcidas. El conductor **oferta** (no
 * asigna): Aceptar deja la tarjeta en "Oferta enviada" y sigue viendo otras.
 */
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { getApiErrorMessage } from '@/core/errors/apiError';
import { colors, fontSize, fontWeight, radius, spacing } from '@/core/theme';
import { DriverSearchMap } from '@/features/driver/presentation/DriverSearchMap';
import { DriverTopBar } from '@/features/driver/presentation/DriverTopBar';
import { OfferSentOverlay } from '@/features/driver/presentation/OfferSentOverlay';
import { RadarPulse } from '@/features/driver/presentation/RadarPulse';
import { RequestCard } from '@/features/driver/presentation/RequestCard';
import { SolicitudesMapa } from '@/features/driver/presentation/SolicitudesMapa';
import { ViajeEnCursoConductorScreen } from '@/features/driver/presentation/ViajeEnCursoConductorScreen';
import { useWatchPosition, type WatchedPosition } from '@/features/home/application/useWatchPosition';
import { useDriverEarnings } from '@/features/rides/application/useCloseFlow';
import { useCreateOffer, useSetOnline, useWithdrawOffer } from '@/features/rides/application/useRideMutations';
import { useDriverActiveRide, useOpenRides } from '@/features/rides/application/useRides';
import type { DriverEarnings, OpenRide } from '@/features/rides/domain/types';
import { FareKeypad } from '@/features/rides/presentation/FareKeypad';
import { useDriverRequests } from '@/features/driver/application/useDriverRequests';
import { useAuthStore } from '@/store/authStore';

type ViewMode = 'list' | 'map';

export function SolicitudesEntrantesScreen() {
  const router = useRouter();
  const { ride: activeRide } = useDriverActiveRide();
  const { rides } = useOpenRides(!activeRide);
  const createOffer = useCreateOffer();

  const user = useAuthStore((s) => s.user);
  const setOnline = useSetOnline();
  const [online, setOnlineState] = useState(user?.isOnline ?? false);
  const toggleOnline = (next: boolean) => {
    setOnlineState(next); // optimista
    setOnline.mutate(next, {
      onSuccess: (value) => setOnlineState(value),
      onError: () => setOnlineState(!next),
    });
  };
  const { data: earnings } = useDriverEarnings(online);
  // Ubicación continua (navegación): el mapa sigue al conductor centrado en el
  // estado de búsqueda y detrás de la lista de solicitudes.
  const position = useWatchPosition();

  const dismissed = useDriverRequests((s) => s.dismissed);
  const rejected = useDriverRequests((s) => s.rejected);
  const expired = useDriverRequests((s) => s.expired);
  const paused = useDriverRequests((s) => s.paused);
  const taken = useDriverRequests((s) => s.taken);
  const offeredMap = useDriverRequests((s) => s.offered);
  const isOffered = useDriverRequests((s) => s.isOffered);
  const dismiss = useDriverRequests((s) => s.dismiss);
  const markOffered = useDriverRequests((s) => s.markOffered);
  const withdrawOffer = useWithdrawOffer();

  const [mode, setMode] = useState<ViewMode>('list');
  const [keypadFor, setKeypadFor] = useState<OpenRide | null>(null);
  // Ride a seleccionar al abrir el mapa desde la lista (toca una tarjeta).
  const [selectedForMap, setSelectedForMap] = useState<string | null>(null);
  // Feedback efímero "Oferta enviada" al enviar una oferta.
  const [offerSent, setOfferSent] = useState(false);

  const visibleRides = useMemo(
    () => rides.filter((r) => !dismissed.has(r.id)),
    [rides, dismissed],
  );

  // Ride cuya oferta/aceptación está en curso (para el "Esperando…" de su tarjeta).
  // Gate por isPending: `createOffer.variables` persiste tras el onSuccess (React
  // Query no lo limpia), así que sin este gate el botón quedaría en spinner fijo.
  const pendingRideId = createOffer.isPending ? createOffer.variables?.rideId ?? null : null;

  // Ofertar NO saca al conductor de la lista: la tarjeta pasa a "Oferta enviada".
  const acceptAtFare = (ride: OpenRide) => {
    createOffer.mutate(
      { rideId: ride.id, input: { acceptAtFare: true } },
      {
        onSuccess: (offer) => {
          markOffered(ride.id, offer);
          setOfferSent(true);
        },
      },
    );
  };

  // Contraoferta rápida (+Bs): envía al instante precio = oferta del pasajero + delta.
  const quickAdd = (ride: OpenRide, delta: number) => {
    const price = Math.round((ride.fare + delta) * 100) / 100;
    createOffer.mutate(
      { rideId: ride.id, input: { acceptAtFare: false, price } },
      {
        onSuccess: (offer) => {
          markOffered(ride.id, offer);
          setOfferSent(true);
        },
      },
    );
  };

  // Precio propio desde el teclado numérico.
  const submitKeypad = (price: number) => {
    if (!keypadFor) return;
    const ride = keypadFor;
    createOffer.mutate(
      { rideId: ride.id, input: { acceptAtFare: false, price } },
      {
        onSuccess: (offer) => {
          markOffered(ride.id, offer);
          setKeypadFor(null);
          setOfferSent(true);
        },
      },
    );
  };

  // Retira la oferta enviada a una solicitud (desde la lista o el mapa).
  const withdraw = (ride: OpenRide) => {
    const offer = useDriverRequests.getState().getOffer(ride.id);
    if (!offer) return;
    withdrawOffer.mutate(offer.offerId, {
      onSuccess: () => useDriverRequests.getState().clearRide(ride.id),
    });
  };

  // Lista: al tocar una tarjeta abre SIEMPRE el mapa con esa solicitud seleccionada
  // (sin importar su estado). El estado se ve en la card del mapa; desde ahí, al
  // tocarla, se abre la pantalla de estado (openStatus).
  const openInMap = (ride: OpenRide) => {
    setSelectedForMap(ride.id);
    setMode('map');
  };

  // Mapa: al tocar la card flotante de una oferta enviada/expirada/rechazada, abre
  // la pantalla de estado (esperando confirmación).
  const openStatus = (ride: OpenRide) => {
    if (isOffered(ride.id) || rejected.has(ride.id) || expired.has(ride.id)) {
      router.push({ pathname: '/(driver)/oferta-enviada', params: { rideId: ride.id } });
    }
  };

  if (activeRide) {
    return <ViajeEnCursoConductorScreen ride={activeRide} />;
  }

  if (visibleRides.length === 0) {
    return (
      <SearchingState
        online={online}
        pending={setOnline.isPending}
        onToggle={toggleOnline}
        earnings={earnings}
        position={position}
      />
    );
  }

  const topBar = (
    <DriverTopBar online={online} pending={setOnline.isPending} onToggle={toggleOnline} />
  );

  return (
    <View style={styles.root}>
      {mode === 'map' ? (
        <View style={styles.mapLayer}>
          <SolicitudesMapa
            key={selectedForMap ?? 'default'}
            rides={visibleRides}
            disabled={createOffer.isPending || withdrawOffer.isPending}
            isOffered={isOffered}
            pendingRideId={pendingRideId}
            offeredMap={offeredMap}
            rejected={rejected}
            expired={expired}
            paused={paused}
            taken={taken}
            initialSelectedId={selectedForMap}
            onOpenDetail={openStatus}
            onAccept={acceptAtFare}
            onDismiss={(r) => dismiss(r.id)}
            onQuickAdd={quickAdd}
            onOpenKeypad={(r) => setKeypadFor(r)}
            onWithdraw={withdraw}
          />
          <View pointerEvents="box-none" style={styles.mapHeader}>
            {topBar}
            <View style={styles.headerGlass}>
              <Text style={styles.headerText}>Solicitudes ({visibleRides.length})</Text>
              <ViewModeToggle mode={mode} onChange={setMode} />
            </View>
          </View>
        </View>
      ) : (
        <>
          <DriverSearchMap
            coordinates={position.coordinates}
            status={position.status}
            retry={position.retry}
          />
          <View style={styles.scrim} pointerEvents="box-none">
            {topBar}
            <View style={styles.headerGlass}>
              <Text style={styles.headerText}>Solicitudes ({visibleRides.length})</Text>
              <ViewModeToggle mode={mode} onChange={setMode} />
            </View>
            {createOffer.isError && (
              <Text style={styles.error}>{getApiErrorMessage(createOffer.error)}</Text>
            )}
            <ScrollView
              style={styles.list}
              contentContainerStyle={styles.listContent}
              showsVerticalScrollIndicator={false}>
              {visibleRides.map((item) => (
                <RequestCard
                  key={item.id}
                  ride={item}
                  offered={isOffered(item.id)}
                  rejected={rejected.has(item.id)}
                  expired={expired.has(item.id)}
                  paused={paused.has(item.id)}
                  taken={taken.has(item.id)}
                  disabled={createOffer.isPending || withdrawOffer.isPending}
                  pendingAccept={pendingRideId === item.id}
                  offerExpiresAt={offeredMap[item.id]?.expiresAt ?? null}
                  onPress={() => openInMap(item)}
                  onAccept={() => acceptAtFare(item)}
                  onDismiss={() => dismiss(item.id)}
                  onQuickAdd={(delta) => quickAdd(item, delta)}
                  onOpenKeypad={() => setKeypadFor(item)}
                  onWithdraw={() => withdraw(item)}
                />
              ))}
            </ScrollView>
          </View>
        </>
      )}

      <FareKeypad
        key={keypadFor?.id ?? 'none'}
        visible={!!keypadFor}
        mode="absolute"
        subtitle={`El pasajero ofrece Bs ${(keypadFor?.fare ?? 0).toFixed(2)}`}
        submitting={createOffer.isPending}
        onCancel={() => setKeypadFor(null)}
        onSubmit={submitKeypad}
      />

      <OfferSentOverlay visible={offerSent} onDone={() => setOfferSent(false)} />
    </View>
  );
}

/** Estado "Buscando viajes" (sin solicitudes). */
function SearchingState({
  online,
  pending,
  onToggle,
  earnings,
  position,
}: {
  online: boolean;
  pending: boolean;
  onToggle: (next: boolean) => void;
  earnings: DriverEarnings | undefined;
  position: WatchedPosition;
}) {
  return (
    <View style={styles.root}>
      <DriverSearchMap coordinates={position.coordinates} status={position.status} retry={position.retry} />
      <View style={styles.scrim} pointerEvents="box-none">
        <DriverTopBar online={online} pending={pending} onToggle={onToggle} />

        <View style={styles.statusPillWrap} pointerEvents="none">
          <View style={styles.statusPill}>
            <Ionicons
              name={online ? 'pulse' : 'cloud-offline-outline'}
              size={16}
              color={online ? colors.success : colors.textSecondary}
            />
            <Text style={styles.statusPillText}>
              {online ? 'Buscando viajes cercanos…' : 'Estás desconectado'}
            </Text>
          </View>
        </View>

        {/* Pulso centrado: el mapa sigue al conductor centrado, así que coincide
            con su ubicación. El ícono rota según el rumbo del vehículo. */}
        {online && position.coordinates && (
          <View style={styles.radarLayer} pointerEvents="none">
            <RadarPulse heading={position.heading} />
          </View>
        )}

        <SafeAreaView edges={['bottom']} style={styles.sheetWrap}>
          <View style={styles.sheet}>
            <View style={styles.sheetHandle} />
            <Text style={styles.sheetTitle}>{online ? 'Buscando viajes' : 'Desconectado'}</Text>
            <Text style={styles.sheetSubtitle}>
              {online ? 'Búsqueda activa en curso' : 'Conéctate para recibir solicitudes'}
            </Text>

            <View style={styles.statsCard}>
              <View style={styles.statsHeader}>
                <Text style={styles.statsLabel}>Rendimiento de hoy</Text>
                <Ionicons name="stats-chart" size={16} color={colors.primary} />
              </View>
              <View style={styles.statsRow}>
                <View style={styles.statItem}>
                  <Text style={styles.statValue}>
                    {earnings ? String(earnings.tripsToday) : '—'}
                  </Text>
                  <Text style={styles.statCaption}>Viajes completados</Text>
                </View>
                <View style={styles.statDivider} />
                <View style={styles.statItem}>
                  <Text style={styles.statValue}>
                    {earnings ? `Bs ${earnings.totalToday.toFixed(2)}` : '—'}
                  </Text>
                  <Text style={styles.statCaption}>Ganancias</Text>
                </View>
              </View>
            </View>
          </View>
        </SafeAreaView>
      </View>
    </View>
  );
}

function ViewModeToggle({
  mode,
  onChange,
}: {
  mode: ViewMode;
  onChange: (mode: ViewMode) => void;
}) {
  return (
    <View style={styles.toggle}>
      <ToggleButton
        icon="list"
        label="Lista"
        active={mode === 'list'}
        onPress={() => onChange('list')}
      />
      <ToggleButton
        icon="map"
        label="Mapa"
        active={mode === 'map'}
        onPress={() => onChange('map')}
      />
    </View>
  );
}

function ToggleButton({
  icon,
  label,
  active,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity
      style={[styles.toggleBtn, active && styles.toggleBtnActive]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      accessibilityLabel={`Ver en ${label.toLowerCase()}`}>
      <Ionicons name={icon} size={14} color={active ? colors.textOnPrimary : colors.textSecondary} />
      <Text style={[styles.toggleText, active && styles.toggleTextActive]}>{label}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  scrim: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },

  // Estado "con solicitudes" — modo lista (sobre el mapa de fondo).
  list: { flex: 1 },
  listContent: { paddingHorizontal: spacing.lg, gap: spacing.md, paddingBottom: spacing.xxl },
  error: {
    color: colors.danger,
    fontSize: fontSize.sm,
    textAlign: 'center',
    marginHorizontal: spacing.lg,
    marginBottom: spacing.xs,
  },

  // Modo mapa.
  mapLayer: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  mapHeader: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    gap: spacing.xs,
  },
  headerGlass: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginHorizontal: spacing.md,
    marginTop: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    backgroundColor: 'rgba(255,255,255,0.9)',
    borderWidth: 1,
    borderColor: 'rgba(226,228,232,0.7)',
    shadowColor: '#000',
    shadowOpacity: 0.1,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 3 },
    elevation: 5,
  },
  headerText: { fontSize: fontSize.md, fontWeight: fontWeight.bold, color: colors.text },

  // Toggle Lista/Mapa.
  toggle: {
    flexDirection: 'row',
    padding: 3,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceMuted,
    gap: 2,
  },
  toggleBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.sm + 2,
    paddingVertical: spacing.xs,
    borderRadius: radius.pill,
  },
  toggleBtnActive: { backgroundColor: colors.primary },
  toggleText: { fontSize: fontSize.xs, fontWeight: fontWeight.medium, color: colors.textSecondary },
  toggleTextActive: { color: colors.textOnPrimary },

  // Estado vacío: status pill + radar + hoja.
  statusPillWrap: { alignItems: 'center', marginTop: spacing.md },
  statusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs + 2,
    borderRadius: radius.pill,
    backgroundColor: 'rgba(255,255,255,0.9)',
    borderWidth: 1,
    borderColor: 'rgba(226,228,232,0.7)',
    shadowColor: '#000',
    shadowOpacity: 0.1,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 3 },
    elevation: 5,
  },
  statusPillText: { fontSize: fontSize.sm, fontWeight: fontWeight.semibold, color: colors.text },

  radarLayer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },

  sheetWrap: { position: 'absolute', bottom: 0, left: 0, right: 0 },
  sheet: {
    marginHorizontal: spacing.md,
    marginBottom: spacing.md,
    padding: spacing.lg,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    shadowColor: '#000',
    shadowOpacity: 0.15,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: -3 },
    elevation: 12,
    gap: spacing.xs,
  },
  sheetHandle: {
    width: 40,
    height: 4,
    borderRadius: radius.pill,
    backgroundColor: colors.border,
    alignSelf: 'center',
    marginBottom: spacing.xs,
  },
  sheetTitle: { fontSize: fontSize.lg, fontWeight: fontWeight.bold, color: colors.text, textAlign: 'center' },
  sheetSubtitle: {
    fontSize: fontSize.xs,
    color: colors.textSecondary,
    textAlign: 'center',
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: spacing.xs,
  },

  statsCard: {
    backgroundColor: 'rgba(22,48,140,0.05)',
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: 'rgba(22,48,140,0.15)',
    padding: spacing.md,
    gap: spacing.sm,
  },
  statsHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  statsLabel: {
    fontSize: fontSize.xs,
    color: colors.textSecondary,
    fontWeight: fontWeight.semibold,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  statsRow: { flexDirection: 'row', alignItems: 'center' },
  statItem: { flex: 1 },
  statValue: { fontSize: fontSize.lg, fontWeight: fontWeight.bold, color: colors.primary },
  statCaption: { fontSize: fontSize.xs, color: colors.textSecondary, marginTop: 2 },
  statDivider: { width: 1, alignSelf: 'stretch', backgroundColor: 'rgba(22,48,140,0.12)', marginHorizontal: spacing.md },
});
