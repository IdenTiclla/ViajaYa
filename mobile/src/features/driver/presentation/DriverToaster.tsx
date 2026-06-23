/**
 * Muestra los toasts del conductor (desenlaces de oferta) en la parte superior,
 * estilo Material-You glass, con auto-descarte a los 3.5 s. Se monta en el layout
 * del conductor para aparecer sobre cualquier pantalla (lista, mapa, inicio).
 */
import { Ionicons } from '@expo/vector-icons';
import { useEffect } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { colors, fontSize, fontWeight, radius, spacing } from '@/core/theme';
import {
  type DriverToast,
  type DriverToastKind,
  useDriverToasts,
} from '@/features/driver/application/useDriverToasts';

const META: Record<DriverToastKind, { icon: keyof typeof Ionicons.glyphMap; color: string }> = {
  expired: { icon: 'time-outline', color: '#B07A00' },
  rejected: { icon: 'close-circle', color: colors.danger },
  taken: { icon: 'car-sport', color: colors.danger },
  cancelled: { icon: 'ban-outline', color: colors.danger },
  paused: { icon: 'create-outline', color: colors.textSecondary },
  accepted: { icon: 'checkmark-circle', color: colors.success },
};

function ToastItem({ toast, onDismiss }: { toast: DriverToast; onDismiss: () => void }) {
  useEffect(() => {
    const timer = setTimeout(onDismiss, 3500);
    return () => clearTimeout(timer);
  }, [toast.id, onDismiss]);

  const meta = META[toast.kind];
  return (
    <Pressable onPress={onDismiss} style={styles.toast} accessibilityRole="alert">
      <View style={[styles.iconWrap, { backgroundColor: `${meta.color}1A` }]}>
        <Ionicons name={meta.icon} size={18} color={meta.color} />
      </View>
      <View style={styles.body}>
        <Text style={styles.title}>{toast.title}</Text>
        <Text style={styles.message}>{toast.message}</Text>
      </View>
    </Pressable>
  );
}

export function DriverToaster() {
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
