/**
 * Register or edit one driver vehicle (`?vehicle=taxi|moto|truck` edits that
 * one) and the services served with it: taxi, taxi + encomiendas, moto,
 * moto + encomiendas or mudanzas. The account keeps its mode until it switches.
 */
import { Ionicons } from '@react-native-vector-icons/ionicons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useRef, useState, type ReactNode } from 'react';
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
import { fontSize, fontWeight, radius, spacing, useThemedStyles, type Theme } from '@/core/theme';
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
import { Button, FeedbackState, TextField } from '@/shared/components';

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

export function DriverRegistrationScreen() {
  const router = useRouter();
  const { vehicle: vehicleParam } = useLocalSearchParams<{ vehicle?: string }>();
  const editingType = isVehicleType(vehicleParam) ? vehicleParam : null;
  const vehicles = useDriverVehicles();

  if (vehicles.isPending) {
    return (
      <RegistrationState>
        <FeedbackState compact loading title="Cargando tus vehículos" message="Estamos preparando tu registro." />
        <Button title="Volver" variant="secondary" onPress={() => router.back()} />
      </RegistrationState>
    );
  }
  if (vehicles.isError && !vehicles.data) {
    return (
      <RegistrationState>
        <FeedbackState compact icon="cloud-offline-outline" title="No pudimos cargar tus vehículos"
          message={getApiErrorMessage(vehicles.error)} />
        <Button title="Reintentar" loading={vehicles.isFetching} onPress={() => { void vehicles.refetch(); }} />
        <Button title="Volver" variant="secondary" onPress={() => router.back()} />
      </RegistrationState>
    );
  }
  const registeredVehicles = vehicles.data ?? [];
  const editing = registeredVehicles.find((vehicle) => vehicle.vehicleType === editingType) ?? null;
  if (vehicleParam && !editing) {
    return (
      <RegistrationState>
        <FeedbackState compact icon="car-sport-outline"
          title="Este vehículo no está disponible"
          message="Vuelve a tu cuenta para revisar los vehículos que tienes registrados." />
        <Button title="Volver a mi cuenta" onPress={() => router.back()} />
      </RegistrationState>
    );
  }
  return (
    <VehicleForm key={editing?.id ?? 'new'} vehicles={registeredVehicles} editing={editing} />
  );
}

/** Result actions stay reachable on short screens and with enlarged text. */
function RegistrationState({ children }: { children: ReactNode }) {
  const { styles } = useThemedStyles(createStyles);
  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={styles.result}>
        <View style={styles.resultContent}>{children}</View>
      </ScrollView>
    </SafeAreaView>
  );
}

function VehicleForm({
  vehicles,
  editing,
}: {
  vehicles: DriverVehicle[];
  editing: DriverVehicle | null;
}) {
  const { colors, styles, focusStyle } = useThemedStyles(createStyles);
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
  const [touched, setTouched] = useState({ plate: false, model: false });
  const [focusedControl, setFocusedControl] = useState<string | null>(null);
  const submitting = useRef(false);

  const allowed = SERVICES_FOR_VEHICLE[vehicleType];
  const chosen = allowed.filter((service) => services.includes(service));
  const busy = register.isPending || switchMode.isPending;
  const plateError = plate.trim().length < 3 ? 'Ingresa una placa de al menos 3 caracteres.' : undefined;
  const modelError = vehicleModel.trim().length < 2 ? 'Ingresa la marca y el modelo de tu vehículo.' : undefined;
  const canSubmit =
    options.length > 0 &&
    options.some((option) => option.id === vehicleType) &&
    chosen.length > 0 &&
    !plateError &&
    !modelError &&
    !busy;

  const changeVehicle = (next: VehicleType) => {
    if (busy || next === vehicleType) return;
    setVehicleType(next);
    // Every vehicle starts with all of its services selected; the driver unticks.
    setServices([...SERVICES_FOR_VEHICLE[next]]);
  };
  const toggleService = (service: ServiceType) =>
    setServices((current) =>
      current.includes(service) ? current.filter((s) => s !== service) : [...current, service],
    );
  const submit = () => {
    if (!canSubmit || submitting.current) return;
    submitting.current = true;
    register.mutate(
      { vehicleType, plate: plate.trim(), vehicleModel: vehicleModel.trim(), services: chosen },
      {
        onSuccess: ({ vehicle }) => setSubmitted(vehicle),
        onSettled: () => { submitting.current = false; },
      },
    );
  };

  if (submitted) {
    const approved = submitted.status === 'approved';
    return (
      <RegistrationState>
        <View style={styles.resultIcon}>
          <Ionicons
            name={approved ? 'checkmark-circle' : 'time'}
            size={64}
            color={approved ? colors.success : colors.primary}
          />
        </View>
        <Text accessibilityRole="header" style={styles.resultTitle}>
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
            title="Volver a mi cuenta"
            variant="secondary"
            disabled={switchMode.isPending}
            onPress={() => router.back()}
          />
        </View>
      </RegistrationState>
    );
  }

  if (options.length === 0) {
    return (
      <RegistrationState>
        <FeedbackState compact icon="car-sport-outline" title="Tus vehículos están registrados"
          message="Ya tienes un vehículo de cada tipo. Puedes editar sus datos desde tu cuenta." />
        <Button title="Volver a mi cuenta" onPress={() => router.back()} />
      </RegistrationState>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag">
          <View style={styles.content}>
            <Pressable
              disabled={busy}
              onPress={() => router.back()}
              onFocus={() => setFocusedControl('back')}
              onBlur={() => setFocusedControl(null)}
              accessibilityRole="button"
              accessibilityLabel="Volver"
              accessibilityState={{ disabled: busy }}
              style={[styles.back, focusedControl === 'back' && focusStyle]}>
              <Ionicons accessible={false} name="arrow-back" size={24} color={colors.text} />
              <Text style={styles.backText}>Volver</Text>
            </Pressable>
            <Text accessibilityRole="header" style={styles.title}>
              {editing
                ? `Tu ${VEHICLE_META[editing.vehicleType].label.toLowerCase()}`
                : vehicles.length === 0
                  ? 'Conviértete en conductor'
                  : 'Agregar vehículo'}
            </Text>
            <Text style={styles.subtitle}>
              {editing
                ? 'Mantén al día los datos de tu vehículo y los servicios que ofreces.'
                : 'Registra tu vehículo para solicitar el acceso como conductor. Puedes seguir usando tu cuenta de pasajero.'}
            </Text>

            <View style={styles.section}>
              <Text accessibilityRole="header" style={styles.sectionLabel}>1. Tu vehículo</Text>
              <SelectableOptionCards options={options} value={vehicleType} onChange={changeVehicle} disabled={busy} />
            </View>

            <View style={styles.section}>
              <Text accessibilityRole="header" style={styles.sectionLabel}>2. Servicios que ofreces</Text>
              <Text style={styles.sectionHint}>Selecciona al menos un servicio para este vehículo.</Text>
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
                      onFocus={() => setFocusedControl(service)}
                      onBlur={() => setFocusedControl(null)}
                      onPress={() => toggleService(service)}
                      style={({ pressed }) => [styles.serviceRow, checked && styles.serviceSelected,
                        pressed && styles.pressed, focusedControl === service && focusStyle]}>
                      <View style={[styles.box, checked && styles.boxChecked]}>
                        {checked && (
                          <Ionicons accessible={false} name="checkmark" size={16} color={colors.textOnPrimary} />
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
            </View>

            <View style={styles.section}>
              <Text accessibilityRole="header" style={styles.sectionLabel}>3. Datos del vehículo</Text>
              <TextField
                label="Placa"
                value={plate}
                onChangeText={setPlate}
                onBlur={() => setTouched((current) => ({ ...current, plate: true }))}
                error={touched.plate ? plateError : undefined}
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
                onBlur={() => setTouched((current) => ({ ...current, model: true }))}
                error={touched.model ? modelError : undefined}
                leadingIcon="construct-outline"
                maxLength={120}
                editable={!busy}
                placeholder={vehicleType === 'moto' ? 'Honda CB125' : vehicleType === 'truck' ? 'Toyota Hilux' : 'Toyota Corolla'}
              />
            </View>

            {register.isError && (
              <Text style={styles.error} accessibilityRole="alert">
                {getApiErrorMessage(register.error)}
              </Text>
            )}
            <View style={styles.actions}>
              <Text style={styles.sectionHint}>
                {busy ? 'Estamos guardando los datos de tu vehículo.'
                  : canSubmit ? 'Revisa tus datos antes de enviarlos.' : 'Completa la placa, el modelo y al menos un servicio.'}
              </Text>
              <Button
                title={editing ? 'Guardar cambios' : 'Registrar vehículo'}
                loading={register.isPending}
                loadingLabel="Guardando vehículo…"
                disabled={!canSubmit}
                onPress={submit}
              />
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const createStyles = ({ colors }: Theme) => StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  flex: { flex: 1 },
  scrollContent: { flexGrow: 1, padding: spacing.md, paddingBottom: spacing.xxl },
  content: { width: '100%', maxWidth: 560, alignSelf: 'center', gap: spacing.md },
  back: { alignSelf: 'flex-start', minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  backText: { fontSize: fontSize.sm, color: colors.text, fontWeight: fontWeight.medium },
  title: { fontSize: fontSize.xl, fontWeight: fontWeight.bold, color: colors.text },
  subtitle: { fontSize: fontSize.md, color: colors.textSecondary, lineHeight: 22 },
  sectionLabel: {
    fontSize: fontSize.md,
    fontWeight: fontWeight.semibold,
    color: colors.text,
  },
  section: { gap: spacing.md, padding: spacing.md, borderRadius: radius.lg,
    borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  sectionHint: { fontSize: fontSize.sm, color: colors.textSecondary, lineHeight: 20 },
  services: { gap: spacing.xs },
  serviceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: 56,
    padding: spacing.sm,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.controlBorder,
    backgroundColor: colors.surface,
  },
  pressed: { opacity: 0.85 },
  serviceSelected: { borderColor: colors.primary, backgroundColor: colors.primarySoft },
  box: {
    width: 24,
    height: 24,
    borderRadius: radius.sm,
    borderWidth: 2,
    borderColor: colors.controlBorder,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
  },
  boxChecked: { borderColor: colors.primary, backgroundColor: colors.primary },
  serviceLabel: { fontSize: fontSize.md, fontWeight: fontWeight.medium, color: colors.text },
  serviceHint: { fontSize: fontSize.sm, color: colors.textSecondary },
  error: { fontSize: fontSize.sm, color: colors.danger },
  actions: { gap: spacing.md },
  result: { flexGrow: 1, justifyContent: 'center', padding: spacing.lg },
  resultContent: { width: '100%', maxWidth: 480, alignSelf: 'center', gap: spacing.md },
  resultIcon: { alignItems: 'center' },
  resultTitle: { fontSize: fontSize.xl, fontWeight: fontWeight.bold, color: colors.text, textAlign: 'center' },
  resultText: { fontSize: fontSize.md, color: colors.textSecondary, textAlign: 'center', lineHeight: 22 },
  resultActions: { alignSelf: 'stretch', gap: spacing.sm, marginTop: spacing.md },
});
