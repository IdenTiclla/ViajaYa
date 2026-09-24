/**
 * Show the driver's toasts (offer outcomes) at the top,
 * Material You glass style, auto-dismissed after 3.5 s. Mounted in the driver's
 * layout so it appears over any screen (list, map, home).
 */
import { Ionicons, type IoniconsIconName } from '@react-native-vector-icons/ionicons';
import { useEffect } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Animated, { FadeInDown, FadeOutUp, LinearTransition } from 'react-native-reanimated';

import { fontSize, fontWeight, radius, spacing, useEstilos, type Tema } from '@/core/theme';
import {
  type DriverToast,
  type DriverToastKind,
  useDriverToasts,
} from '@/features/driver/application/useDriverToasts';

function ToastItem({ toast, onDismiss }: { toast: DriverToast; onDismiss: () => void }) {
  const { colors, styles } = useEstilos(crearEstilos);
  useEffect(() => {
    const timer = setTimeout(onDismiss, 3500);
    return () => clearTimeout(timer);
  }, [toast.id, onDismiss]);

  const META: Record<DriverToastKind, { icon: IoniconsIconName; color: string }> = {
    expired: { icon: 'time-outline', color: colors.aviso },
    rejected: { icon: 'close-circle', color: colors.danger },
    taken: { icon: 'car-sport', color: colors.danger },
    cancelled: { icon: 'ban-outline', color: colors.danger },
    paused: { icon: 'create-outline', color: colors.textSecondary },
    accepted: { icon: 'checkmark-circle', color: colors.success },
    connection_error: { icon: 'cloud-offline-outline', color: colors.danger },
  };
  const meta = META[toast.kind];
  return (
    <Animated.View
      entering={FadeInDown.duration(250)}
      exiting={FadeOutUp.duration(200)}
      layout={LinearTransition.duration(200)}>
      <Pressable
        onPress={onDismiss}
        style={styles.toast}
        accessibilityRole="alert"
        accessibilityHint="Toca para cerrar el aviso">
        <View style={[styles.iconWrap, { backgroundColor: `${meta.color}1A` }]}>
          <Ionicons name={meta.icon} size={18} color={meta.color} />
        </View>
        <View style={styles.body}>
          <Text style={styles.title}>{toast.title}</Text>
          <Text style={styles.message} numberOfLines={2}>{toast.message}</Text>
        </View>
        <Ionicons name="close" size={18} color={colors.textSecondary} />
      </Pressable>
    </Animated.View>
  );
}

export function DriverToaster() {
  const { styles } = useEstilos(crearEstilos);
  const toasts = useDriverToasts((s) => s.toasts);
  const dismiss = useDriverToasts((s) => s.dismiss);

  if (toasts.length === 0) return null;
  return (
    <SafeAreaView edges={['top']} style={styles.wrap} pointerEvents="box-none">
      <View style={styles.stack}>
        {toasts.map((t) => (
          <ToastItem key={t.id} toast={t} onDismiss={() => dismiss(t.id)} />
        ))}
      </View>
    </SafeAreaView>
  );
}

const crearEstilos = ({ colors }: Tema) => StyleSheet.create({
  wrap: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    zIndex: 1000,
  },
  stack: { width: '100%', maxWidth: 440, gap: spacing.sm },
  toast: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    shadowColor: '#000',
    shadowOpacity: 0.18,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 8,
  },
  iconWrap: {
    width: 36,
    height: 36,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  body: { flex: 1, gap: 1 },
  title: { fontSize: fontSize.sm, fontWeight: fontWeight.bold, color: colors.text },
  message: { fontSize: fontSize.xs, color: colors.textSecondary },
});
