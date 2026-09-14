import { useEffect, useRef, useState } from 'react';
import { AppState, StyleSheet, Text, View } from 'react-native';

import { fontSize, spacing, useEstilos, type Tema } from '@/core/theme';
import { Button } from '@/shared/components/Button';
import { TextField } from '@/shared/components/TextField';
import { usePhoneVerification } from '../application/usePhoneVerification';
import type { PhoneChallenge, PhoneVerificationProof } from '../domain/phoneVerification';
import { AuthHeading, AuthNotice } from './entry/AuthScaffold';

type Props = {
  phone: string;
  deviceId: string;
  onVerified: (proof: PhoneVerificationProof) => void;
  onChangePhone: () => void;
  purpose?: PhoneChallenge['purpose'];
  autoRequest?: boolean;
};

/** Reuse the bounded verification controller in login, recovery, and phone changes. */
export function PhoneCodeForm({ phone, deviceId, onVerified, onChangePhone,
  purpose = 'sign_in', autoRequest = false }: Props) {
  const { state, controller } = usePhoneVerification(phone, deviceId, purpose);
  const { styles } = useEstilos(createStyles);
  const [now, setNow] = useState(Date.now);
  const deliveredProof = useRef<string | null>(null);
  useEffect(() => {
    if (!autoRequest) return;
    // Delay one tick so Strict Mode's first cleanup cancels before any SMS request.
    const timer = setTimeout(() => { void controller.request(phone, deviceId); }, 0);
    return () => clearTimeout(timer);
  }, [autoRequest, controller, phone, deviceId]);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') setNow(Date.now());
    });
    return () => { clearInterval(timer); subscription.remove(); };
  }, []);
  useEffect(() => {
    if (state.phase === 'waiting' && AppState.currentState === 'active') {
      void controller.retryRequest(phone, deviceId);
    }
  }, [controller, deviceId, now, phone, state.phase]);
  useEffect(() => {
    if (state.proof && controller.getSnapshot().proof === state.proof
      && deliveredProof.current !== state.proof.verificationToken) {
      deliveredProof.current = state.proof.verificationToken;
      onVerified(state.proof);
    }
  }, [state.proof, onVerified, controller]);
  const busy = state.phase === 'requesting' || state.phase === 'verifying';
  const retrySeconds = Math.max(0, Math.ceil((state.resendAt - now) / 1000));
  const verifySeconds = Math.max(0, Math.ceil((state.verifyAt - now) / 1000));
  return (
    <View style={styles.container}>
      <AuthHeading title="Verifica tu número" text={`Enviamos un código de seis dígitos al ${phone}.`} />
      {controller.simulated && <Text style={styles.hint}>OTP de prueba · sin SMS</Text>}
      {state.phase === 'waiting' && <View accessibilityLiveRegion="polite">
        <AuthNotice>Ya solicitaste un código hace poco. Pediremos uno nuevo cuando termine la espera.</AuthNotice>
      </View>}
      {state.challenge && (
        <>
          <TextField label="Código de seis dígitos" value={state.code} leadingIcon="shield-checkmark-outline"
            onChangeText={controller.setCode} keyboardType="number-pad" maxLength={6}
            editable={!busy} autoComplete="one-time-code" textContentType="oneTimeCode"
            placeholder="123456" style={styles.code} error={state.error ?? undefined} />
          <Button title={verifySeconds ? `Continuar en ${verifySeconds} s` : 'Continuar'}
            loading={state.phase === 'verifying'}
            disabled={busy || state.code.length !== 6 || verifySeconds > 0}
            onPress={() => { void controller.verify(deviceId); }} />
        </>
      )}
      {!state.challenge && state.error && <AuthNotice tone="error">{state.error}</AuthNotice>}
      {state.phase !== 'verified' && (
        <Button title={retrySeconds ? `Solicitar código en ${retrySeconds} s` : 'Solicitar código'}
          variant="secondary" loading={state.phase === 'requesting'}
          disabled={busy || retrySeconds > 0}
          onPress={() => { void controller.request(phone, deviceId); }} />
      )}
      <Button title="Cambiar número" variant="secondary" onPress={() => {
        controller.reset();
        onChangePhone();
      }} />
    </View>
  );
}

const createStyles = ({ colors }: Tema) => StyleSheet.create({
  container: { gap: spacing.md },
  hint: { fontSize: fontSize.sm, color: colors.aviso },
  code: { fontSize: fontSize.lg, letterSpacing: 6 },
});
