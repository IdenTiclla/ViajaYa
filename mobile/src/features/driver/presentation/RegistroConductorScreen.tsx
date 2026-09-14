/**
 * Register or edit one driver vehicle (`?vehicle=taxi|moto|truck` edits that
 * one) and the services served with it: taxi, taxi + encomiendas, moto,
 * moto + encomiendas or mudanzas. The account keeps its mode until it switches.
 */
import { Ionicons } from '@react-native-vector-icons/ionicons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import {
  ActivityIndicator,
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
import {
  useDriverVehicles,
  useRegisterDriverVehicle,
  useSwitchAccountMode,
} from '@/features/driver/application/useDriverAccount';
import type { DriverVehicle } from '@/features/driver/domain/types';
import { Button, TextField } from '@/shared/components';

const VEHICLE_OPTIONS: readonly SelectableOption<VehicleType>[] = VEHICLE_ORDER.map((id) => ({
  id,
  label: VEHICLE_META[id].label,
  icon: VEHICLE_META[id].icon,
  accessibilityLabel: VEHICLE_META[id].label,
}));

function isVehicleType(value: unknown): value is VehicleType {
  return typeof value === 'string' && (VEHICLE_ORDER as readonly string[]).includes(value);
}

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
  const { vehicle: vehicleParam } = useLocalSearchParams<{ vehicle?: string }>();
  const editingType = isVehicleType(vehicleParam) ? vehicleParam : null;
  const vehicles = useDriverVehicles();

  if (vehicles.isPending) {
    return (
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        <View style={styles.result}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      </SafeAreaView>
    );
  }
  if (vehicles.isError) {
    return (
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        <View style={styles.result}>
          <Text style={styles.error} accessibilityRole="alert">
            {getApiErrorMessage(vehicles.error)}
          </Text>
          <View style={styles.resultActions}>
            <Button title="Reintentar" onPress={() => vehicles.refetch()} />
            <Button title="Volver" variant="secondary" onPress={() => router.back()} />
          </View>
        </View>
      </SafeAreaView>
    );
  }
  return (
    <VehicleForm
      vehicles={vehicles.data}
      editing={vehicles.data.find((v) => v.vehicleType === editingType) ?? null}
    />
  );
}

function VehicleForm({
  vehicles,
  editing,
}: {
  vehicles: DriverVehicle[];
  editing: DriverVehicle | null;
}) {
  const { colors, styles } = useEstilos(crearEstilos);
  const router = useRouter();
  const register = useRegisterDriverVehicle();
  const switchMode = useSwitchAccountMode();

  const taken = new Set(vehicles.map((v) => v.vehicleType));
  // When adding, only vehicle types not registered yet can be chosen.
  const options = editing
    ? VEHICLE_OPTIONS.filter((o) => o.id === editing.vehicleType)
    : VEHICLE_OPTIONS.filter((o) => !taken.has(o.id));
  const [vehicleType, setVehicleType] = useState<VehicleType>(
    editing?.vehicleType ?? options[0]?.id ?? 'taxi',
  );
  const [services, setServices] = useState<ServiceType[]>(() =>
    editing ? editing.services : [...SERVICES_FOR_VEHICLE[vehicleType]],
  );
  const [plate, setPlate] = useState(editing?.plate ?? '');
  const [vehicleModel, setVehicleModel] = useState(editing?.vehicleModel ?? '');
  const [submitted, setSubmitted] = useState<DriverVehicle | null>(null);

  const allowed = SERVICES_FOR_VEHICLE[vehicleType];
  const chosen = allowed.filter((service) => services.includes(service));
  const busy = register.isPending || switchMode.isPending;
  const canSubmit =
    options.length > 0 &&
    chosen.length > 0 &&
    plate.trim().length >= 3 &&
    vehicleModel.trim().length >= 2 &&
    !busy;

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
    register.mutate(
      { vehicleType, plate: plate.trim(), vehicleModel: vehicleModel.trim(), services: chosen },
      { onSuccess: ({ vehicle }) => setSubmitted(vehicle) },
    );

  if (submitted) {
    const approved = submitted.status === 'approved';
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
              ? `Tu ${VEHICLE_META[submitted.vehicleType].label.toLowerCase()} está aprobado. Cambia a modo conductor cuando quieras recibir solicitudes.`
              : 'Lo revisaremos y te avisaremos cuando esté aprobado. Mientras tanto puedes seguir viajando como pasajero.'}
          </Text>
          {switchMode.isError && (
            <Text style={styles.error} accessibilityRole="alert">
              {getApiErrorMessage(switchMode.error)}
            </Text>
          )}
          <View style={styles.resultActions}>
            {approved && (
              <Button
                title={`Conducir con ${VEHICLE_META[submitted.vehicleType].label.toLowerCase()}`}
                loading={switchMode.isPending}
                onPress={() =>
                  switchMode.mutate({ mode: 'driver', vehicleType: submitted.vehicleType })
                }
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
            {editing
              ? `Tu ${VEHICLE_META[editing.vehicleType].label.toLowerCase()}`
              : vehicles.length === 0
                ? 'Conviértete en conductor'
                : 'Agregar vehículo'}
          </Text>
          <Text style={styles.subtitle}>
            Elige tu vehículo y los servicios que quieres ofrecer. Tu cuenta de pasajero se
            conserva: cambias de modo cuando quieras.
          </Text>

          <Text style={styles.sectionLabel}>Vehículo</Text>
          {options.length === 0 ? (
            <Text style={styles.error}>Ya registraste un vehículo de cada tipo.</Text>
          ) : (
            <SelectableOptionCards options={options} value={vehicleType} onChange={changeVehicle} />
          )}

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

          {register.isError && (
            <Text style={styles.error} accessibilityRole="alert">
              {getApiErrorMessage(register.error)}
            </Text>
          )}
          <View style={styles.actions}>
            <Button
              title={editing ? 'Guardar cambios' : 'Registrar vehículo'}
              loading={register.isPending}
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
