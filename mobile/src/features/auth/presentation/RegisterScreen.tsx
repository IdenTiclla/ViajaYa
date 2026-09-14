import { router } from 'expo-router';
import { useState } from 'react';

import { Button, TextField } from '@/shared/components';
import { useAuthController } from '../application/useAuthController';
import { AuthLink } from './entry/AuthLink';
import { AuthHeading, AuthLoading, AuthNotice, AuthScaffold } from './entry/AuthScaffold';
import { PhoneInput } from './entry/PhoneInput';
import { ProfileCompletionForm } from './entry/ProfileCompletionForm';
import { SessionEntering } from './entry/SessionEntering';
import { TermsCheckbox } from './entry/TermsCheckbox';
import { PhoneCodeForm } from './PhoneCodeForm';

const goToSignIn = () => { if (router.canGoBack()) router.back(); else router.replace('/(auth)'); };

/**
 * Sign-up: name + phone + terms first, then OTP. The profile travels with the completion request,
 * so a new number gets its account in one step; an existing number simply signs in.
 */
export function RegisterScreen() {
  const { controller, state } = useAuthController();
  const [fullName, setFullName] = useState('');
  const [number, setNumber] = useState('');
  const [callingCode, setCallingCode] = useState('+591');
  const [accepted, setAccepted] = useState(false);
  const enabled = !!state.capabilities?.enabled;
  const termsVersion = state.capabilities?.termsVersion;
  const nameValid = fullName.trim().length >= 2;
  const canSubmit = enabled && nameValid && number.length >= 6 && accepted && !!termsVersion && !state.busy;

  const phoneStep = state.step === 'phone';
  return (
    <AuthScaffold subtitle="Crea tu cuenta en menos de un minuto."
      footer={phoneStep ? <AuthLink prompt="¿Ya tienes cuenta?" label="Inicia sesión"
        disabled={state.busy} onPress={goToSignIn} /> : undefined}>
      {state.step === 'loading' && (
        <AuthLoading busy={state.busy} error={state.error} onRetry={() => { void controller.initialize(); }} />
      )}
      {phoneStep && <>
        <AuthHeading title="Crea tu cuenta"
          text="Te enviaremos un código por SMS para verificar tu número." />
        <TextField label="Tu nombre" value={fullName} onChangeText={setFullName} leadingIcon="person-outline"
          autoComplete="name" textContentType="name" maxLength={100} editable={!state.busy}
          placeholder="Nombre y apellido" />
        <PhoneInput countries={state.capabilities?.countries ?? []} callingCode={callingCode}
          onChangeCallingCode={setCallingCode} number={number} onChangeNumber={setNumber} editable={!state.busy} />
        <TermsCheckbox termsText={state.capabilities?.termsText} checked={accepted} onChange={setAccepted}
          disabled={state.busy} />
        {!enabled && <AuthNotice tone="error">
          El registro por teléfono aún no está disponible en este servidor. Vuelve a intentar en unos momentos.
        </AuthNotice>}
        {!enabled && <Button title="Reintentar conexión" variant="secondary" loading={state.busy}
          onPress={() => { void controller.initialize(); }} />}
        <Button title="Crear cuenta" trailingIcon="arrow-forward" disabled={!canSubmit}
          onPress={() => controller.start(`${callingCode}${number}`, 'sign_in',
            termsVersion ? { fullName: fullName.trim(), termsVersion } : null)} />
      </>}
      {state.step === 'code' && (
        <PhoneCodeForm phone={state.phone} deviceId={state.deviceId} autoRequest purpose="sign_in"
          onVerified={(proof) => { void controller.verified(proof); }} onChangePhone={controller.back} />
      )}
      {state.step === 'profile' && <>
        <ProfileCompletionForm phone={state.phone} capabilities={state.capabilities} busy={state.busy}
          initialName={fullName} onSubmit={(profile) => { void controller.complete(profile); }} />
        <Button title="Cambiar número" variant="secondary" disabled={state.busy} onPress={controller.back} />
      </>}
      {state.step === 'complete' && (
        <SessionEntering busy={state.busy} error={state.error}
          onRetry={() => { void controller.complete(); }} onBack={controller.back} />
      )}
      {state.step !== 'complete' && state.step !== 'loading' && state.error && (
        <AuthNotice tone="error">{state.error}</AuthNotice>
      )}
    </AuthScaffold>
  );
}
