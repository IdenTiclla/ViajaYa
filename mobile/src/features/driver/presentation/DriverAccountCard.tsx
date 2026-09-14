/**
 * Passenger profile block: invites to register as a driver, shows the review
 * status of the application and, once approved, switches to driver mode.
 */
import { Ionicons, type IoniconsIconName } from '@react-native-vector-icons/ionicons';
import { useRouter } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';

import { getApiErrorMessage } from '@/core/errors/apiError';
import { fontSize, fontWeight, radius, spacing, useEstilos, type Tema } from '@/core/theme';
import { vehicleLabel } from '@/features/auth/domain/vehicleCatalog';
import { SERVICE_META } from '@/features/booking/domain/serviceCatalog';
import { useSwitchAccountMode } from '@/features/driver/application/useDriverAccount';
import { Button } from '@/shared/components';
import { useAuthStore } from '@/store/authStore';

export function DriverAccountCard() {
  const { colors, styles } = useEstilos(crearEstilos);
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const switchMode = useSwitchAccountMode();
  if (!user) return null;

  const goToForm = () => router.navigate('/(app)/conductor/registro');
  const vehicle = [vehicleLabel(user.vehicleType), user.vehicleModel, user.plate]
    .filter(Boolean)
    .join(' · ');
  const services = user.driverServices.map((s) => SERVICE_META[s].shortLabel).join(' · ');

  let icon: IoniconsIconName = 'car-sport-outline';
  let title = 'Conviértete en conductor';
  let text = 'Ofrece viajes en taxi o moto, encomiendas o mudanzas con tu propio vehículo.';
  if (user.driverStatus === 'pending') {
    icon = 'time-outline';
    title = 'Solicitud en revisión';
    text = `Estamos revisando tu registro (${vehicle}). Te avisaremos cuando esté aprobado.`;
  } else if (user.driverStatus === 'rejected') {
    icon = 'alert-circle-outline';
    title = 'Registro no aprobado';
    text = 'Revisa los datos de tu vehículo y vuelve a enviar la solicitud.';
  } else if (user.driverStatus === 'approved') {
    icon = 'checkmark-circle-outline';
    title = 'Modo conductor disponible';
    text = `${vehicle}\nServicios: ${services}`;
  }

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <Ionicons accessible={false} name={icon} size={22} color={colors.primary} />
        <Text style={styles.title}>{title}</Text>
      </View>
      <Text style={styles.text}>{text}</Text>
      {switchMode.isError && (
        <Text style={styles.error} accessibilityRole="alert">
          {getApiErrorMessage(switchMode.error)}
        </Text>
      )}
      <View style={styles.actions}>
        {user.driverStatus === 'approved' ? (
          <>
            <Button
              title="Cambiar a modo conductor"
              loading={switchMode.isPending}
              onPress={() => switchMode.mutate('driver')}
            />
            <Button
              title="Editar vehículo y servicios"
              variant="secondary"
              disabled={switchMode.isPending}
              onPress={goToForm}
            />
          </>
        ) : user.driverStatus === 'pending' ? (
          <Button title="Editar solicitud" variant="secondary" onPress={goToForm} />
        ) : (
          <Button
            title={user.driverStatus === 'rejected' ? 'Volver a enviar' : 'Registrarme como conductor'}
            variant="secondary"
            onPress={goToForm}
          />
        )}
      </View>
    </View>
  );
}

const crearEstilos = ({ colors }: Tema) => StyleSheet.create({
  card: {
    alignSelf: 'stretch',
    marginTop: spacing.lg,
    padding: spacing.md,
    gap: spacing.sm,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  title: { flex: 1, fontSize: fontSize.md, fontWeight: fontWeight.semibold, color: colors.text },
  text: { fontSize: fontSize.sm, color: colors.textSecondary, lineHeight: 20 },
  error: { fontSize: fontSize.sm, color: colors.danger },
  actions: { gap: spacing.sm, marginTop: spacing.xs },
});
