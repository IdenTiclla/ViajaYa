import * as Crypto from 'expo-crypto';
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { getApiErrorMessage } from '@/core/errors/apiError';
import { fontSize, fontWeight, radius, spacing, useEstilos, type Tema } from '@/core/theme';
import { Button, TextField } from '@/shared/components';
import { useAuthStore } from '@/store/authStore';
import { createPhoneAccessController, type EntryMode } from '../application/phoneAccessController';
import { getInstallationId } from '../data/installationId';
import { phoneAccessRepository } from '../data/phoneAccessRepository';
import { BrandHeader } from './BrandHeader';
import { PhoneCodeForm } from './PhoneCodeForm';

export function PhoneEntryScreen() {
  const { styles, estiloFoco } = useEstilos(createStyles);
  const controller = useMemo(() => createPhoneAccessController({
    repository: phoneAccessRepository, installationId: getInstallationId,
    randomId: Crypto.randomUUID, deviceName: Platform.OS === 'ios' ? 'iPhone' : 'Android',
    acceptSession: (result) => useAuthStore.getState().acceptPhoneSession(result),
    errorMessage: (error) => getApiErrorMessage(error,
      error instanceof Error ? error.message : 'No pudimos continuar. Vuelve a intentar.'),
  }), []);
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  const [number, setNumber] = useState('');
  const [callingCode, setCallingCode] = useState('+591');
  const [fullName, setFullName] = useState('');
  const [accepted, setAccepted] = useState(false);
  const [termsFocused, setTermsFocused] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [hint, setHint] = useState('');
  const [reason, setReason] = useState('');
  const [caseId, setCaseId] = useState('');
  const [mode, setMode] = useState<EntryMode>('sign_in');
  useEffect(() => {
    void controller.initialize();
    return () => controller.dispose();
  }, [controller]);
  const recovering = mode === 'recovery' || mode === 'recovery_complete';
  const back = () => { setPassword(''); controller.back(); };
  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <BrandHeader subtitle="Tu ciudad, a un toque de distancia." />
          <View style={styles.form}>
            {state.step === 'loading' && <>
              <Text style={styles.title}>Preparamos tu acceso</Text>
              <Button title="Reintentar conexión" loading={state.busy}
                onPress={() => { void controller.initialize(); }} />
            </>}
            {state.step === 'phone' && <>
              <Text accessibilityRole="header" style={styles.title}>
                {recovering ? 'Recupera tu cuenta' : mode === 'legacy' ? 'Conserva tu cuenta anterior' : 'Entra con tu número'}
              </Text>
              <Text style={styles.text}>{recovering
                ? 'Verifica un número al que tengas acceso. La recuperación requiere revisar tu identidad.'
                : mode === 'legacy' ? 'Verifica tu número y luego usa tu correo y contraseña anteriores. Conservaremos tus viajes y tu rol.'
                  : 'Usa tu teléfono para iniciar sesión o crear tu cuenta.'}</Text>
              {state.capabilities?.countries.map((country) => (
                <Button key={country.region} title={`${country.region === 'BO' ? 'Bolivia' : country.region} (${country.callingCode})${callingCode === country.callingCode ? ' ✓' : ''}`}
                  variant="secondary" onPress={() => setCallingCode(country.callingCode)} />
              ))}
              <TextField label={recovering ? 'Número de contacto' : 'Número de teléfono'}
                value={number} onChangeText={(value) => setNumber(value.replace(/[^0-9]/g, ''))}
                keyboardType="phone-pad" autoComplete="tel-national" maxLength={15}
                placeholder="71234567" />
              {!state.capabilities?.enabled && <Text accessibilityRole="alert" style={styles.text}>
                El acceso por teléfono aún no está disponible en este servidor. Vuelve a intentar en unos momentos.
              </Text>}
              {!state.capabilities?.enabled && <Button title="Reintentar conexión" variant="secondary"
                loading={state.busy} onPress={() => { void controller.initialize(); }} />}
              <Button title="Continuar" disabled={!state.capabilities?.enabled || number.length < 6}
                onPress={() => controller.start(`${callingCode}${number}`, mode)} />
              <Button title={mode === 'legacy' ? 'Volver al acceso por teléfono' : 'Ya tenía una cuenta con correo'}
                variant="secondary" onPress={() => setMode(mode === 'legacy' ? 'sign_in' : 'legacy')} />
              <Button title={recovering ? 'Volver al acceso por teléfono' : 'No tengo acceso a mi número'}
                variant="secondary" onPress={() => setMode(recovering ? 'sign_in' : 'recovery')} />
              {recovering && <Button title={mode === 'recovery_complete' ? 'Solicitar una revisión' : 'Ya tengo una recuperación aprobada'}
                variant="secondary" onPress={() => setMode(mode === 'recovery_complete' ? 'recovery' : 'recovery_complete')} />}
            </>}
            {state.step === 'code' && <PhoneCodeForm phone={state.phone} deviceId={state.deviceId}
              autoRequest purpose={state.mode.startsWith('recovery') ? 'recovery' : 'sign_in'}
              onVerified={(proof) => { void controller.verified(proof); }} onChangePhone={back} />}
            {state.step === 'profile' && <>
              <Text accessibilityRole="header" style={styles.title}>Completa tu cuenta</Text>
              <Text style={styles.text}>{state.phone} · verificado</Text>
              <TextField label="Tu nombre" value={fullName} onChangeText={setFullName}
                autoComplete="name" maxLength={100} editable={!state.busy} />
              <Text style={styles.text}>{state.capabilities?.termsText}</Text>
              <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: accepted, disabled: state.busy }}
                disabled={state.busy} onPress={() => setAccepted(!accepted)}
                onFocus={() => setTermsFocused(true)} onBlur={() => setTermsFocused(false)}
                aria-checked={accepted} style={[styles.checkbox, termsFocused && estiloFoco]}>
                <Text style={styles.text}>{accepted ? '☑' : '☐'} He leído y acepto estas condiciones.</Text>
              </Pressable>
              <Button title="Crear cuenta" loading={state.busy} disabled={!accepted || fullName.trim().length < 2}
                onPress={() => { void controller.complete({ fullName, termsVersion: state.capabilities?.termsVersion }); }} />
              <Button title="Ya tenía una cuenta" variant="secondary" disabled={state.busy}
                onPress={() => { setMode('legacy'); back(); }} />
            </>}
            {state.step === 'legacy' && <>
              <Text style={styles.title}>Vincula tu cuenta anterior</Text>
              <Text style={styles.text}>Tu número {state.phone} será la nueva forma de entrar.</Text>
              <TextField label="Correo anterior" value={email} onChangeText={setEmail}
                autoCapitalize="none" keyboardType="email-address" autoComplete="email" editable={!state.busy} />
              <TextField label="Contraseña anterior" value={password} onChangeText={setPassword}
                password autoComplete="current-password" editable={!state.busy} />
              <Button title="Conservar mi cuenta" loading={state.busy} disabled={!email.trim() || !password}
                onPress={() => { void controller.complete({ email: email.trim(), password }); }} />
            </>}
            {state.step === 'recovery' && (state.mode === 'recovery_complete' ? <>
              <Text style={styles.title}>Completa la recuperación</Text>
              <TextField label="Código de caso aprobado" value={caseId} onChangeText={setCaseId}
                autoCapitalize="none" editable={!state.busy} />
              <Button title="Recuperar mi cuenta" loading={state.busy} disabled={caseId.trim().length !== 36}
                onPress={() => { void controller.completeRecovery(caseId.trim()); }} />
            </> : <>
              <Text style={styles.title}>Solicita una revisión</Text>
              <TextField label="Número anterior o correo de la cuenta" value={hint} onChangeText={setHint}
                maxLength={255} editable={!state.busy} />
              <TextField label="Cuéntanos qué ocurrió" value={reason} onChangeText={setReason}
                multiline maxLength={1000} editable={!state.busy} />
              <Text style={styles.text}>No incluyas contraseñas ni documentos. Esta solicitud no cambia tu cuenta automáticamente.</Text>
              <Button title="Registrar solicitud" loading={state.busy} disabled={hint.trim().length < 3 || reason.trim().length < 10}
                onPress={() => { void controller.requestRecovery(hint, reason); }} />
            </>)}
            {state.step === 'case' && <>
              <Text style={styles.title}>Solicitud registrada</Text>
              <Text style={styles.text}>Guarda este código de caso:</Text>
              <Text selectable style={styles.text}>{state.caseId}</Text>
              <Text style={styles.text}>Tu cuenta conserva sus datos. La revisión de solicitudes se habilitará con el soporte de ViajaYa; en esta etapa de pruebas no hay un plazo de respuesta.</Text>
            </>}
            {state.error && <Text accessibilityRole="alert" style={styles.error}>{state.error}</Text>}
            {state.step === 'complete' && <Button title="Reintentar acceso" loading={state.busy}
              onPress={() => { void controller.complete(); }} />}
            {!['phone', 'code', 'loading'].includes(state.step) && <Button title="Volver al inicio"
              variant="secondary" disabled={state.busy} onPress={back} />}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const createStyles = ({ colors }: Tema) => StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  flex: { flex: 1 },
  content: { flexGrow: 1, padding: spacing.lg, gap: spacing.xl, justifyContent: 'center' },
  form: { width: '100%', maxWidth: 480, alignSelf: 'center', gap: spacing.md },
  title: { fontSize: fontSize.xl, fontWeight: fontWeight.bold, color: colors.text },
  text: { fontSize: fontSize.md, color: colors.textSecondary },
  error: { fontSize: fontSize.md, color: colors.danger },
  checkbox: { minHeight: 48, justifyContent: 'center', padding: spacing.sm,
    borderWidth: 1, borderColor: colors.bordeControl, borderRadius: radius.sm },
});
