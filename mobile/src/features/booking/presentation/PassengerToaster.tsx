/**
 * Muestra los toasts del pasajero (desenlaces de oferta) en la parte superior,
 * estilo Material-You glass, con auto-descarte a los 3.5 s. Se monta en el layout
 * autenticado del pasajero para aparecer sobre cualquier pantalla.
 */
import { Ionicons } from '@expo/vector-icons';
import { useEffect } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Animated, { FadeInDown, FadeOutUp, LinearTransition } from 'react-native-reanimated';

import { colors, fontSize, fontWeight, radius, spacing } from '@/core/theme';
import {
  type PassengerToast,
  type PassengerToastKind,
  usePassengerToasts,
} from '@/features/booking/application/usePassengerToasts';

const META: Record<PassengerToastKind, { icon: keyof typeof Ionicons.glyphMap; color: string }> = {
  offer_received: { icon: 'pricetag', color: colors.success },
  offer_expired: { icon: 'time-outline', color: '#B07A00' },
  offer_withdrawn: { icon: 'remove-circle-outline', color: colors.textSecondary },
};

function ToastItem({ toast, onDismiss }: { toast: PassengerToast; onDismiss: () => void }) {
  useEffect(() => {
    const timer = setTimeout(onDismiss, 3500);
    return () => clearTimeout(timer);
  }, [toast.id, onDismiss]);

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

export function PassengerToaster() {
  const toasts = usePassengerToasts((s) => s.toasts);
  const dismiss = usePassengerToasts((s) => s.dismiss);

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

const styles = StyleSheet.create({
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
    backgroundColor: 'rgba(255,255,255,0.95)',
    borderWidth: 1,
    borderColor: 'rgba(226,228,232,0.7)',
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
