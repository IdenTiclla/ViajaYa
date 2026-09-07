import { Ionicons } from '@expo/vector-icons';
import { useRef } from 'react';
import { AccessibilityInfo, findNodeHandle, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';

import { colors, fontSize, fontWeight, radius, spacing } from '@/core/theme';
import { Button } from './Button';

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
  const tituloRef = useRef<Text>(null);
  const { width, fontScale } = useWindowDimensions();
  const accionesEnColumna = width < 380 || fontScale > 1.2;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
      onShow={() => {
        // En web el Modal administra el foco mediante su contenedor de diálogo.
        if (Platform.OS === 'web') return;
        const titulo = findNodeHandle(tituloRef.current);
        if (titulo != null) AccessibilityInfo.setAccessibilityFocus(titulo);
      }}
      onRequestClose={onCancel}>
      {/* Fondo: tocar fuera cancela. */}
      <Pressable style={styles.backdrop} onPress={onCancel} accessible={false}>
        {/* Tarjeta: detiene la propagación para no cancelar al tocarla. */}
        <Pressable
          style={styles.card}
          onPress={() => {}}
          accessible={false}
          onAccessibilityEscape={onCancel}
          accessibilityViewIsModal>
          <ScrollView style={styles.scroll} contentContainerStyle={styles.contenido} bounces={false}>
          {icon && (
            <View style={[styles.iconWrap, { backgroundColor: `${accent}1A` }]}>
              <Ionicons name={icon} size={26} color={accent} />
            </View>
          )}
          <Text ref={tituloRef} style={styles.title} accessibilityRole="header">{title}</Text>
          {message ? <Text style={styles.message}>{message}</Text> : null}

          <View style={[styles.actions, accionesEnColumna && styles.actionsColumn]}>
            <Button
              title={cancelText}
              variant="secondary"
              style={!accionesEnColumna && styles.button}
              onPress={onCancel}
            />
            <Button
              title={confirmText}
              variant={destructive ? 'danger' : 'primary'}
              style={!accionesEnColumna && styles.button}
              onPress={onConfirm}
            />
          </View>
          </ScrollView>
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
    maxHeight: '90%',
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    shadowColor: '#000',
    shadowOpacity: 0.18,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
    elevation: 12,
  },
  scroll: { flexShrink: 1 },
  contenido: { padding: spacing.lg, alignItems: 'center', gap: spacing.sm },
  iconWrap: {
    width: 44,
    height: 44,
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
  actionsColumn: { flexDirection: 'column' },
  button: { flex: 1 },
});
