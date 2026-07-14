import { Ionicons } from '@expo/vector-icons';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, fontSize, fontWeight, radius, spacing } from '@/core/theme';

type Props = {
  visible: boolean;
  title: string;
  message?: string;
  confirmText?: string;
  cancelText?: string;
  /** Resalta la acción de confirmar en rojo (p. ej. eliminar). */
  destructive?: boolean;
  /** Ícono de Ionicons mostrado sobre el título. */
  icon?: keyof typeof Ionicons.glyphMap;
  onConfirm: () => void;
  onCancel: () => void;
};

/**
 * Diálogo de confirmación con el estilo de la app (en vez del `Alert` nativo).
 * Controlado por `visible`; el padre decide qué hacer en confirmar/cancelar.
 */
export function ConfirmDialog({
  visible,
  title,
  message,
  confirmText = 'Confirmar',
  cancelText = 'Cancelar',
  destructive = false,
  icon,
  onConfirm,
  onCancel,
}: Props) {
  const accent = destructive ? colors.danger : colors.primary;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={onCancel}>
      {/* Fondo: tocar fuera cancela. */}
      <Pressable style={styles.backdrop} onPress={onCancel} accessible={false}>
        {/* Tarjeta: detiene la propagación para no cancelar al tocarla. */}
        <Pressable
          style={styles.card}
          onPress={() => {}}
          accessible={false}
          accessibilityViewIsModal>
          {icon && (
            <View style={[styles.iconWrap, { backgroundColor: `${accent}1A` }]}>
              <Ionicons name={icon} size={26} color={accent} />
            </View>
          )}
          <Text style={styles.title}>{title}</Text>
          {message ? <Text style={styles.message}>{message}</Text> : null}

          <View style={styles.actions}>
            <Pressable
              style={({ pressed }) => [styles.button, styles.cancel, pressed && styles.pressed]}
              onPress={onCancel}
              accessibilityRole="button"
              accessibilityLabel={cancelText}>
              <Text
                style={styles.cancelText}
                numberOfLines={2}
                adjustsFontSizeToFit
                minimumFontScale={0.85}>
                {cancelText}
              </Text>
            </Pressable>
            <Pressable
              style={({ pressed }) => [
                styles.button,
                { backgroundColor: accent },
                pressed && styles.pressed,
              ]}
              onPress={onConfirm}
              accessibilityRole="button"
              accessibilityLabel={confirmText}>
              <Text
                style={styles.confirmText}
                numberOfLines={2}
                adjustsFontSizeToFit
                minimumFontScale={0.85}>
                {confirmText}
              </Text>
            </Pressable>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.lg,
  },
  card: {
    width: '100%',
    maxWidth: 360,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.lg,
    alignItems: 'center',
    gap: spacing.sm,
    shadowColor: '#000',
    shadowOpacity: 0.18,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
    elevation: 12,
  },
  iconWrap: {
    width: 52,
    height: 52,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.xs,
  },
  title: {
    fontSize: fontSize.lg,
    fontWeight: fontWeight.bold,
    color: colors.text,
    textAlign: 'center',
  },
  message: {
    fontSize: fontSize.sm,
    color: colors.textSecondary,
    textAlign: 'center',
    lineHeight: 20,
  },
  actions: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.md,
    alignSelf: 'stretch',
  },
  button: {
    flex: 1,
    minHeight: 48,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cancel: { backgroundColor: colors.surfaceMuted },
  pressed: { opacity: 0.7 },
  cancelText: {
    fontSize: fontSize.md,
    fontWeight: fontWeight.semibold,
    color: colors.text,
    textAlign: 'center',
  },
  confirmText: {
    fontSize: fontSize.md,
    fontWeight: fontWeight.semibold,
    color: colors.textOnPrimary,
    textAlign: 'center',
  },
});
