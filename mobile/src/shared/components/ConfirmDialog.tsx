import { Ionicons, type IoniconsIconName } from '@react-native-vector-icons/ionicons';
import { useRef } from 'react';
import { AccessibilityInfo, findNodeHandle, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { fontSize, fontWeight, radius, spacing, useEstilos, type Tema } from '@/core/theme';
import { Button } from './Button';

type Props = {
  visible: boolean;
  title: string;
  message?: string;
  confirmText?: string;
  cancelText?: string;
  /** Highlight the confirm action in red (e.g. delete). */
  destructive?: boolean;
  /** Ionicons icon shown above the title. */
  icon?: IoniconsIconName;
  onConfirm: () => void;
  onCancel: () => void;
};

/**
 * Confirmation dialog with the app's style (instead of the native `Alert`).
 * Controlled by `visible`; the parent decides what to do on confirm/cancel.
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
  const { colors, styles } = useEstilos(crearEstilos);
  const accent = destructive ? colors.danger : colors.primary;
  const tituloRef = useRef<Text>(null);
  const { width, fontScale } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const mobileLayout = width < 600;
  const accionesEnColumna = mobileLayout || fontScale > 1.2;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
      onShow={() => {
        // On web the Modal manages focus through its dialog container.
        if (Platform.OS === 'web') return;
        const titulo = findNodeHandle(tituloRef.current);
        if (titulo != null) AccessibilityInfo.setAccessibilityFocus(titulo);
      }}
      onRequestClose={onCancel}>
      {/* Fondo: tocar fuera cancela. */}
      <Pressable style={[styles.backdrop, mobileLayout && styles.mobileBackdrop,
        { paddingTop: Math.max(insets.top, spacing.md), paddingBottom: Math.max(insets.bottom, spacing.md) }]}
        onPress={onCancel} accessible={false}>
        {/* Card: stops propagation so tapping it does not cancel. */}
        <Pressable
          style={styles.card}
          onPress={event => event.stopPropagation()}
          accessible={false}
          onAccessibilityEscape={onCancel}
          accessibilityViewIsModal>
          <ScrollView style={styles.scroll} contentContainerStyle={styles.contenido} bounces={false}>
          {icon && (
            <View style={[styles.iconWrap, { backgroundColor: destructive ? colors.peligroSuave : colors.primarioSuave }]}>
              <Ionicons name={icon} size={26} color={accent} />
            </View>
          )}
          <Text ref={tituloRef} style={styles.title} accessibilityRole="header">{title}</Text>
          {message ? <Text style={styles.message}>{message}</Text> : null}

          </ScrollView>
          <View style={[styles.actions, accionesEnColumna && styles.actionsColumn]}>
            <Button
              title={cancelText}
              variant="text"
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
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const crearEstilos = ({ colors }: Tema) => StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
  },
  mobileBackdrop: { justifyContent: 'flex-end' },
  card: {
    width: '100%',
    maxWidth: 440,
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
  contenido: { padding: spacing.lg, alignItems: 'flex-start', gap: spacing.sm },
  iconWrap: {
    width: 52,
    height: 52,
    borderRadius: radius.lg,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.xs,
  },
  title: {
    fontSize: fontSize.lg,
    fontWeight: fontWeight.bold,
    color: colors.text,
    textAlign: 'left',
  },
  message: {
    fontSize: fontSize.sm,
    color: colors.textSecondary,
    textAlign: 'left',
    lineHeight: 20,
  },
  actions: {
    flexDirection: 'row',
    gap: spacing.sm,
    padding: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    alignSelf: 'stretch',
  },
  actionsColumn: { flexDirection: 'column-reverse' },
  button: { flex: 1 },
});
