import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { fontSize, fontWeight, radius, spacing, useEstilos, type Tema } from '@/core/theme';
import { Button, TextField } from '@/shared/components';
import type { EntryMode } from '../application/phoneAccessController';
import { useAuthController } from '../application/useAuthController';
import { AuthLink } from './entry/AuthLink';
import { AuthHeading, AuthLoading, AuthNotice, AuthScaffold } from './entry/AuthScaffold';
import { PhoneInput } from './entry/PhoneInput';
import { SessionEntering } from './entry/SessionEntering';
import { PhoneCodeForm } from './PhoneCodeForm';

type RecoveryMode = Extract<EntryMode, 'recovery' | 'recovery_complete'>;
const OPTIONS: { mode: RecoveryMode; label: string }[] = [
  { mode: 'recovery', label: 'Solicitar revisión' },
  { mode: 'recovery_complete', label: 'Tengo un caso aprobado' },
];

const goToSignIn = () => { if (router.canGoBack()) router.back(); else router.replace('/(auth)'); };

/** Account recovery when the user lost access to their number: request a review or redeem an approved case. */
export function RecoveryScreen() {
  const { controller, state } = useAuthController();
  const { styles } = useEstilos(createStyles);
  const [mode, setMode] = useState<RecoveryMode>('recovery');
  const [number, setNumber] = useState('');
  const [callingCode, setCallingCode] = useState('+591');
  const [hint, setHint] = useState('');
  const [reason, setReason] = useState('');
  const [caseId, setCaseId] = useState('');
  const enabled = !!state.capabilities?.enabled;

  return (
    <AuthScaffold subtitle="Recupera el acceso a tu cuenta."
      footer={<AuthLink label="Volver al inicio de sesión" disabled={state.busy} onPress={goToSignIn} />}>
      {state.step === 'loading' && (
        <AuthLoading busy={state.busy} error={state.error} onRetry={() => { void controller.initialize(); }} />
      )}
      {state.step === 'phone' && <>
        <AuthHeading title="Recupera tu cuenta"
          text="Verifica un número al que sí tengas acceso. Un equipo revisará tu identidad antes de devolverte la cuenta." />
        <View accessibilityRole="radiogroup" style={styles.segments}>
          {OPTIONS.map((option) => {
            const selected = option.mode === mode;
            return (
              <Pressable key={option.mode} accessibilityRole="radio" accessibilityState={{ selected, checked: selected }}
                onPress={() => setMode(option.mode)} style={[styles.segment, selected && styles.segmentSelected]}>
                <Text style={[styles.segmentText, selected && styles.segmentTextSelected]}>{option.label}</Text>
              </Pressable>
            );
          })}
        </View>
        <PhoneInput label="Número de contacto" countries={state.capabilities?.countries ?? []}
          callingCode={callingCode} onChangeCallingCode={setCallingCode}
          number={number} onChangeNumber={setNumber} editable={!state.busy} />
        {!enabled && <AuthNotice tone="error">
          La recuperación aún no está disponible en este servidor. Vuelve a intentar en unos momentos.
        </AuthNotice>}
        <Button title="Continuar" trailingIcon="arrow-forward" disabled={!enabled || number.length < 6 || state.busy}
          onPress={() => controller.start(`${callingCode}${number}`, mode)} />
      </>}
      {state.step === 'code' && (
        <PhoneCodeForm phone={state.phone} deviceId={state.deviceId} autoRequest purpose="recovery"
          onVerified={(proof) => { void controller.verified(proof); }} onChangePhone={controller.back} />
      )}
      {state.step === 'recovery' && (state.mode === 'recovery_complete' ? <>
        <AuthHeading title="Completa la recuperación"
          text="Ingresa el código de caso que recibiste al aprobarse tu solicitud." />
        <TextField label="Código de caso aprobado" value={caseId} onChangeText={setCaseId}
          leadingIcon="key-outline" autoCapitalize="none" autoCorrect={false} editable={!state.busy} />
        <Button title="Recuperar mi cuenta" loading={state.busy} disabled={caseId.trim().length !== 36}
          onPress={() => { void controller.completeRecovery(caseId.trim()); }} />
      </> : <>
        <AuthHeading title="Solicita una revisión"
          text="Cuéntanos cómo identificar tu cuenta anterior. No incluyas contraseñas ni documentos." />
        <TextField label="Número anterior de la cuenta" value={hint} onChangeText={setHint}
          leadingIcon="call-outline" keyboardType="phone-pad" maxLength={255} editable={!state.busy} />
        <TextField label="Cuéntanos qué ocurrió" value={reason} onChangeText={setReason}
          multiline numberOfLines={4} maxLength={1000} editable={!state.busy} style={styles.multiline} />
        <AuthNotice>Esta solicitud no cambia tu cuenta automáticamente; primero la revisamos.</AuthNotice>
        <Button title="Registrar solicitud" loading={state.busy}
          disabled={hint.trim().length < 3 || reason.trim().length < 10}
          onPress={() => { void controller.requestRecovery(hint, reason); }} />
      </>)}
      {state.step === 'case' && <>
        <AuthHeading title="Solicitud registrada" text="Guarda este código de caso; lo necesitarás para completar la recuperación." />
        <Text selectable accessibilityLabel={`Código de caso ${state.caseId}`} style={styles.caseId}>{state.caseId}</Text>
        <AuthNotice>
          Tu cuenta conserva sus datos. La revisión de solicitudes se habilitará con el soporte de ViajaYa;
          en esta etapa de pruebas no hay un plazo de respuesta.
        </AuthNotice>
        <Button title="Volver al inicio" variant="secondary" onPress={goToSignIn} />
      </>}
      {state.step === 'complete' && (
        <SessionEntering busy={state.busy} error={state.error}
          onRetry={() => { void controller.complete(); }} onBack={controller.back} />
      )}
      {state.step !== 'complete' && state.step !== 'loading' && state.error && (
        <AuthNotice tone="error">{state.error}</AuthNotice>
      )}
      {state.step === 'recovery' && (
        <Button title="Cambiar número" variant="secondary" disabled={state.busy} onPress={controller.back} />
      )}
    </AuthScaffold>
  );
}

const createStyles = ({ colors }: Tema) => StyleSheet.create({
  segments: { flexDirection: 'row', padding: spacing.xs, borderRadius: radius.md, backgroundColor: colors.surfaceMuted, gap: spacing.xs },
  segment: { flex: 1, minHeight: 40, alignItems: 'center', justifyContent: 'center', borderRadius: radius.sm, paddingHorizontal: spacing.sm },
  segmentSelected: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.primary },
  segmentText: { fontSize: fontSize.sm, color: colors.textSecondary, textAlign: 'center' },
  segmentTextSelected: { color: colors.primary, fontWeight: fontWeight.semibold },
  multiline: { minHeight: 96, textAlignVertical: 'top' },
  caseId: { fontSize: fontSize.md, fontWeight: fontWeight.semibold, color: colors.text, textAlign: 'center',
    padding: spacing.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.primary, backgroundColor: colors.primarioSuave },
});
