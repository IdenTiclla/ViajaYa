/**
 * "Conviértete en conductor": a passenger registers the vehicle and the services
 * they want to serve (taxi, taxi + encomiendas, moto, moto + encomiendas or
 * mudanzas). The account stays a passenger until it switches mode.
 */
import { Ionicons } from '@react-native-vector-icons/ionicons';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { getApiErrorMessage } from '@/core/errors/apiError';
import { fontSize, fontWeight, radius, spacing, useEstilos, type Tema } from '@/core/theme';
import type { VehicleType } from '@/features/auth/domain/types';
import {
  SERVICES_FOR_VEHICLE,
  VEHICLE_META,
  VEHICLE_ORDER,
} from '@/features/auth/domain/vehicleCatalog';
import { SERVICE_META } from '@/features/booking/domain/serviceCatalog';
import type { ServiceType } from '@/features/booking/domain/types';
import {
  SelectableOptionCards,
  type SelectableOption,
} from '@/features/booking/presentation/SelectableOptionCards';
import { useApplyAsDriver, useSwitchAccountMode } from '@/features/driver/application/useDriverAccount';
import { Button, TextField } from '@/shared/components';
import { useAuthStore } from '@/store/authStore';

const VEHICLE_OPTIONS: readonly SelectableOption<VehicleType>[] = VEHICLE_ORDER.map((id) => ({
  id,
  label: VEHICLE_META[id].label,
  icon: VEHICLE_META[id].icon,
  accessibilityLabel: VEHICLE_META[id].label,
}));

/** What each service means for a driver of that vehicle. */
const SERVICE_HINTS: Record<ServiceType, string> = {
  taxi: 'Viajes de pasajeros en tu auto.',
  moto: 'Viajes de pasajeros en tu moto.',
  delivery: 'Cargas y encomiendas pequeñas.',
  moving: 'Traslado de muebles y cargas grandes.',
};

export function RegistroConductorScreen() {
  const { colors, styles } = useEstilos(crearEstilos);
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const apply = useApplyAsDriver();
  const switchMode = useSwitchAccountMode();

  const editing = user?.driverStatus != null;
  const [vehicleType, setVehicleType] = useState<VehicleType>(user?.vehicleType ?? 'taxi');
  const [services, setServices] = useState<ServiceType[]>(() =>
    user?.driverServices.length ? user.driverServices : [...SERVICES_FOR_VEHICLE[vehicleType]],
  );
  const [plate, setPlate] = useState(user?.plate ?? '');
  const [vehicleModel, setVehicleModel] = useState(user?.vehicleModel ?? '');
  const [submitted, setSubmitted] = useState(false);

  const allowed = SERVICES_FOR_VEHICLE[vehicleType];
  const chosen = allowed.filter((service) => services.includes(service));
  const busy = apply.isPending || switchMode.isPending;
  const canSubmit =
    chosen.length > 0 && plate.trim().length >= 3 && vehicleModel.trim().length >= 2 && !busy;

  const changeVehicle = (next: VehicleType) => {
    setVehicleType(next);
    // Every vehicle starts with all of its services selected; the driver unticks.
    setServices([...SERVICES_FOR_VEHICLE[next]]);
  };
  const toggleService = (service: ServiceType) =>
    setServices((current) =>
      current.includes(service) ? current.filter((s) => s !== service) : [...current, service],
    );
  const submit = () =>
    apply.mutate(
      { vehicleType, plate: plate.trim(), vehicleModel: vehicleModel.trim(), services: chosen },
      { onSuccess: () => setSubmitted(true) },
    );

  if (submitted && user?.driverStatus) {
    const approved = user.driverStatus === 'approved';
    return (
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        <View style={styles.result}>
          <Ionicons
            name={approved ? 'checkmark-circle' : 'time'}
            size={64}
            color={approved ? colors.success : colors.primary}
          />
          <Text style={styles.resultTitle}>
            {approved ? '¡Ya puedes conducir!' : 'Recibimos tu solicitud'}
          </Text>
          <Text style={styles.resultText}>
            {approved
              ? 'Tu registro está aprobado. Cambia a modo conductor cuando quieras recibir solicitudes.'
              : 'La revisaremos y te avisaremos cuando esté aprobada. Mientras tanto puedes seguir viajando como pasajero.'}
          </Text>
          {switchMode.isError && (
            <Text style={styles.error} accessibilityRole="alert">
              {getApiErrorMessage(switchMode.error)}
            </Text>
          )}
          <View style={styles.resultActions}>
            {approved && (
              <Button
                title="Cambiar a modo conductor"
                loading={switchMode.isPending}
                onPress={() => switchMode.mutate('driver')}
              />
            )}
            <Button
              title="Seguir como pasajero"
              variant="secondary"
              disabled={switchMode.isPending}
              onPress={() => router.back()}
            />
          </View>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <Pressable
            onPress={() => router.back()}
            accessibilityRole="button"
            accessibilityLabel="Volver"
            hitSlop={12}
            style={styles.back}>
            <Ionicons name="arrow-back" size={24} color={colors.text} />
          </Pressable>
          <Text style={styles.title}>
            {editing ? 'Tu registro de conductor' : 'Conviértete en conductor'}
          </Text>
          <Text style={styles.subtitle}>
            Elige tu vehículo y los servicios que quieres ofrecer. Tu cuenta de pasajero se
            conserva: cambias de modo cuando quieras.
          </Text>

          <Text style={styles.sectionLabel}>Vehículo</Text>
          <SelectableOptionCards
            options={VEHICLE_OPTIONS}
            value={vehicleType}
            onChange={changeVehicle}
          />

          <Text style={styles.sectionLabel}>Servicios que ofreces</Text>
          <View style={styles.services} accessibilityRole="list">
            {allowed.map((service) => {
              const checked = chosen.includes(service);
              const locked = allowed.length === 1;
              return (
                <Pressable
                  key={service}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked, disabled: locked || busy }}
                  aria-checked={checked}
                  disabled={locked || busy}
                  onPress={() => toggleService(service)}
                  style={({ pressed }) => [styles.serviceRow, pressed && styles.pressed]}>
                  <View style={[styles.box, checked && styles.boxChecked]}>
                    {checked && (
                      <Ionicons name="checkmark" size={16} color={colors.textOnPrimary} />
                    )}
                  </View>
                  <View style={styles.flex}>
                    <Text style={styles.serviceLabel}>{SERVICE_META[service].label}</Text>
                    <Text style={styles.serviceHint}>{SERVICE_HINTS[service]}</Text>
                  </View>
                </Pressable>
              );
            })}
          </View>
          {chosen.length === 0 && (
            <Text style={styles.error} accessibilityRole="alert">
              Elige al menos un servicio.
            </Text>
          )}

          <Text style={styles.sectionLabel}>Datos del vehículo</Text>
          <TextField
            label="Placa"
            value={plate}
            onChangeText={setPlate}
            leadingIcon="card-outline"
            autoCapitalize="characters"
            autoCorrect={false}
            maxLength={20}
            editable={!busy}
            placeholder="1234-ABC"
          />
          <TextField
            label="Marca y modelo"
            value={vehicleModel}
            onChangeText={setVehicleModel}
            leadingIcon="construct-outline"
            maxLength={120}
            editable={!busy}
            placeholder={vehicleType === 'moto' ? 'Honda CB125' : 'Toyota Corolla'}
          />

          {apply.isError && (
            <Text style={styles.error} accessibilityRole="alert">
              {getApiErrorMessage(apply.error)}
            </Text>
          )}
          <View style={styles.actions}>
            <Button
              title={editing ? 'Guardar cambios' : 'Enviar registro'}
              loading={apply.isPending}
              disabled={!canSubmit}
              onPress={submit}
            />
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const crearEstilos = ({ colors }: Tema) => StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  flex: { flex: 1 },
  content: { padding: spacing.lg, gap: spacing.sm, paddingBottom: spacing.xxl },
  back: { alignSelf: 'flex-start', minHeight: 48, minWidth: 48, justifyContent: 'center' },
  title: { fontSize: fontSize.xl, fontWeight: fontWeight.bold, color: colors.text },
  subtitle: { fontSize: fontSize.md, color: colors.textSecondary, lineHeight: 22 },
  sectionLabel: {
    marginTop: spacing.md,
    fontSize: fontSize.sm,
    fontWeight: fontWeight.semibold,
    color: colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  services: { gap: spacing.xs },
  serviceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: 56,
    padding: spacing.sm,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.bordeControl,
    backgroundColor: colors.surface,
  },
  pressed: { opacity: 0.85 },
  box: {
    width: 24,
    height: 24,
    borderRadius: radius.sm,
    borderWidth: 2,
    borderColor: colors.bordeControl,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
  },
  boxChecked: { borderColor: colors.primary, backgroundColor: colors.primary },
  serviceLabel: { fontSize: fontSize.md, fontWeight: fontWeight.medium, color: colors.text },
  serviceHint: { fontSize: fontSize.sm, color: colors.textSecondary },
  error: { fontSize: fontSize.sm, color: colors.danger },
  actions: { marginTop: spacing.lg },
  result: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.lg, gap: spacing.md },
  resultTitle: { fontSize: fontSize.xl, fontWeight: fontWeight.bold, color: colors.text, textAlign: 'center' },
  resultText: { fontSize: fontSize.md, color: colors.textSecondary, textAlign: 'center', lineHeight: 22 },
  resultActions: { alignSelf: 'stretch', gap: spacing.sm, marginTop: spacing.md },
});
