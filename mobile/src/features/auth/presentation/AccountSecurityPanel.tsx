import { useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { getApiErrorMessage } from '@/core/errors/apiError';
import { fontSize, fontWeight, spacing, useEstilos, type Tema } from '@/core/theme';
import { Button, TextField } from '@/shared/components';
import { useAuthStore } from '@/store/authStore';
import { getInstallationId } from '../data/installationId';
import { accountSessionsRepository } from '../data/phoneAccessRepository';
import type { AccountSession } from '../domain/phoneAccess';
import { PhoneCodeForm } from './PhoneCodeForm';

export function AccountSecurityPanel() {
  const { styles } = useEstilos(createStyles);
  const user = useAuthStore((state) => state.user);
  const [sessions, setSessions] = useState<AccountSession[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [changing, setChanging] = useState(false);
  const [phone, setPhone] = useState('+591');
  const [verification, setVerification] = useState<{ phone: string; deviceId: string } | null>(null);
  const active = useRef(true);
  const pending = useRef<AbortController | null>(null);
  const locked = useRef(false);
  useEffect(() => {
    active.current = true;
    return () => { active.current = false; pending.current?.abort(); };
  }, []);

  async function run(operation: () => Promise<void>) {
    if (locked.current) return;
    locked.current = true; setBusy(true); setError(null); setNotice(null);
    try { await operation(); }
    catch (failure) {
      if (active.current) setError(getApiErrorMessage(failure,
        failure instanceof Error ? failure.message : 'No pudimos completar la acción.'));
    } finally {
      locked.current = false;
      if (active.current) setBusy(false);
    }
  }
  async function load() {
    pending.current?.abort(); pending.current = new AbortController();
    const result = await accountSessionsRepository.list(pending.current.signal);
    if (active.current) setSessions(result.sessions);
  }
  return (
    <View style={styles.container}>
      <Text accessibilityRole="header" style={styles.title}>Acceso y seguridad</Text>
      {!user?.phoneVerifiedAt ? <>
        <Text style={styles.text}>Esta cuenta no tiene un número verificado. Cierra sesión y vuelve a entrar con tu teléfono para administrar tus sesiones.</Text>
      </> : <>
        <Text style={styles.text}>Número verificado: {user.phone}</Text>
        <Button title={sessions ? 'Actualizar sesiones' : 'Ver sesiones abiertas'} variant="secondary"
          loading={busy && !changing} onPress={() => { void run(load); }} />
        {sessions?.map((session) => <View key={session.id} style={styles.session}>
          <Text style={styles.text}>{session.deviceName}{session.current ? ' · este teléfono' : ''}</Text>
          <Text style={styles.text}>Última actividad: {new Date(session.lastSeenAt).toLocaleString('es-BO')}</Text>
          {!session.current && <Button title="Cerrar esta sesión" variant="dangerSoft" disabled={busy}
            onPress={() => { void run(async () => { await accountSessionsRepository.revoke(session.id); await load(); }); }} />}
        </View>)}
        {sessions && sessions.some((session) => !session.current) && <Button title="Cerrar las otras sesiones"
          variant="dangerSoft" disabled={busy} onPress={() => { void run(async () => {
            await accountSessionsRepository.revokeOthers(); await load();
          }); }} />}
        {!changing && <Button title="Cambiar mi número" variant="secondary" disabled={busy}
          onPress={() => { setChanging(true); setError(null); }} />}
        {changing && <>
          <Text style={styles.text}>Para cambiar tu número debes haber iniciado sesión en los últimos cinco minutos. Si hace más tiempo, vuelve a entrar con tu número actual.</Text>
          {verification ? <PhoneCodeForm phone={verification.phone} deviceId={verification.deviceId}
            purpose="change_phone" autoRequest onChangePhone={() => { if (!busy) setVerification(null); }}
            onVerified={(proof) => { void run(async () => {
              const result = await accountSessionsRepository.changePhone(
                verification.phone, proof.verificationToken, verification.deviceId,
              );
              if (!active.current) return;
              await useAuthStore.getState().acceptPhoneSession(result);
              if (!active.current) return;
              setVerification(null); setChanging(false); setSessions(null);
              setNotice('Número actualizado. Las sesiones anteriores quedaron cerradas.');
            }); }} /> : <>
            <TextField label="Nuevo número, con código de país" value={phone} onChangeText={setPhone}
              keyboardType="phone-pad" editable={!busy} maxLength={20} />
            <Button title="Verificar nuevo número" loading={busy} disabled={phone.length < 8}
              onPress={() => { void run(async () => {
                const deviceId = await getInstallationId();
                if (active.current) setVerification({ phone, deviceId });
              }); }} />
          </>}
          <Button title="Cancelar cambio" variant="secondary" disabled={busy}
            onPress={() => { setChanging(false); setVerification(null); setError(null); }} />
        </>}
      </>}
      {notice && <Text accessibilityRole="alert" style={styles.text}>{notice}</Text>}
      {error && <Text accessibilityRole="alert" style={styles.error}>{error}</Text>}
    </View>
  );
}

const createStyles = ({ colors }: Tema) => StyleSheet.create({
  container: { alignSelf: 'stretch', gap: spacing.md, marginTop: spacing.lg },
  title: { fontSize: fontSize.lg, fontWeight: fontWeight.bold, color: colors.text },
  text: { fontSize: fontSize.sm, color: colors.textSecondary },
  error: { fontSize: fontSize.sm, color: colors.danger },
  session: { gap: spacing.sm, borderBottomWidth: 1, borderColor: colors.border, paddingVertical: spacing.md },
});
