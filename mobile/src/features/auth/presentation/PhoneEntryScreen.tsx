import { router } from 'expo-router';
import { useState } from 'react';

import { Button } from '@/shared/components';
import { useAuthController } from '../application/useAuthController';
import { useSocialAuth } from '../application/useSocialAuth';
import { AuthLink } from './entry/AuthLink';
import { AuthHeading, AuthLoading, AuthNotice, AuthScaffold } from './entry/AuthScaffold';
import { PhoneInput } from './entry/PhoneInput';
import { ProfileCompletionForm } from './entry/ProfileCompletionForm';
import { SessionEntering } from './entry/SessionEntering';
import { SocialButtons } from './entry/SocialButtons';
import { PhoneCodeForm } from './PhoneCodeForm';

/** Sign-in: phone + OTP, or Google/Facebook linked to a verified phone. */
export function PhoneEntryScreen() {
  const { controller, state } = useAuthController();
  const [number, setNumber] = useState('');
  const [callingCode, setCallingCode] = useState('+591');
  const [socialError, setSocialError] = useState<string | null>(null);
  const social = useSocialAuth({
    onCredential: (credential) => controller.signInSocial(credential),
    onError: setSocialError,
  });
  const back = () => { setSocialError(null); controller.back(); };
  const enabled = !!state.capabilities?.enabled;
  const socialName = state.socialProvider === 'google' ? 'Google' : 'Facebook';
  const socialBusy = social.googleLoading || social.facebookLoading;
  const busy = state.busy || socialBusy;
  const providers = state.capabilities?.socialProviders ?? [];

  const phoneStep = state.step === 'phone';
  return (
    <AuthScaffold subtitle="Tu ciudad, a un toque de distancia."
      footer={phoneStep && !state.socialProvider ? <>
        <AuthLink prompt="¿Aún no tienes cuenta?" label="Regístrate" disabled={busy}
          onPress={() => router.push('/(auth)/register')} />
        <AuthLink label="No tengo acceso a mi número" disabled={busy}
          onPress={() => router.push('/(auth)/recovery')} />
      </> : undefined}>
      {state.step === 'loading' && (
        <AuthLoading busy={state.busy} error={state.error} onRetry={() => { void controller.initialize(); }} />
      )}
      {phoneStep && <>
        <AuthHeading title={state.socialProvider ? `Vincula ${socialName} a tu número` : 'Bienvenido a ViajaYa'}
          text={state.socialProvider
            ? `Verificamos tu cuenta de ${socialName}. Ahora confirma tu número; después podrás vincular ambos.`
            : 'Ingresa tu número y te enviaremos un código por SMS.'} />
        <PhoneInput countries={state.capabilities?.countries ?? []} callingCode={callingCode}
          onChangeCallingCode={setCallingCode} number={number} onChangeNumber={setNumber} editable={!busy} />
        {!enabled && <AuthNotice tone="error">
          El acceso por teléfono aún no está disponible en este servidor. Vuelve a intentar en unos momentos.
        </AuthNotice>}
        {!enabled && <Button title="Reintentar conexión" variant="secondary" loading={state.busy}
          onPress={() => { void controller.initialize(); }} />}
        <Button title="Continuar" trailingIcon="arrow-forward" disabled={!enabled || number.length < 6 || busy}
          onPress={() => controller.start(`${callingCode}${number}`, state.socialProvider ? 'social' : 'sign_in')} />
        {state.socialProvider
          ? <Button title="Usar solo mi teléfono" variant="secondary" disabled={busy} onPress={back} />
          : <SocialButtons providers={providers}
            google={{ loading: social.googleLoading, disabled: state.busy || social.googleDisabled,
              onPress: () => { setSocialError(null); social.signInWithGoogle(); } }}
            facebook={{ loading: social.facebookLoading, disabled: state.busy || social.facebookDisabled,
              onPress: () => { setSocialError(null); social.signInWithFacebook(); } }} />}
      </>}
      {state.step === 'code' && (
        <PhoneCodeForm phone={state.phone} deviceId={state.deviceId} autoRequest purpose="sign_in"
          onVerified={(proof) => { void controller.verified(proof); }} onChangePhone={back} />
      )}
      {state.step === 'social_confirmation' && <>
        <AuthHeading title={`Confirma tu acceso con ${socialName}`}
          text={`Vincularemos tu cuenta de ${socialName} con el número verificado ${state.phone}. `
            + 'Si ya tenías una cuenta con esa identidad, conservaremos tus viajes y tu rol.'} />
        <Button title={`Vincular ${socialName} y continuar`} loading={state.busy}
          onPress={() => { void controller.complete(); }} />
        <Button title="Cancelar" variant="secondary" disabled={state.busy} onPress={back} />
      </>}
      {state.step === 'profile' && <>
        <ProfileCompletionForm phone={state.phone} capabilities={state.capabilities} busy={state.busy}
          onSubmit={(profile) => { void controller.complete(profile); }} />
        <Button title="Cambiar número" variant="secondary" disabled={state.busy} onPress={back} />
      </>}
      {state.step === 'complete' && (
        <SessionEntering busy={state.busy} error={state.error}
          onRetry={() => { void controller.complete(); }} onBack={back} />
      )}
      {state.step !== 'complete' && state.step !== 'loading' && state.error && (
        <AuthNotice tone="error">{state.error}</AuthNotice>
      )}
      {socialError && <AuthNotice tone="error">{socialError}</AuthNotice>}
    </AuthScaffold>
  );
}
