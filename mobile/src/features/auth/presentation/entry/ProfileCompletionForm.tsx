import { useState } from 'react';

import { Button, TextField } from '@/shared/components';
import type { PhoneCapabilities } from '../../domain/phoneAccess';
import { AuthHeading } from './AuthScaffold';
import { TermsCheckbox } from './TermsCheckbox';

type Props = {
  phone: string;
  capabilities: PhoneCapabilities | null;
  busy: boolean;
  initialName?: string;
  onSubmit: (profile: { fullName: string; termsVersion: string | undefined }) => void;
};

/** Shown when the server reports `profile_required` for a verified number without an account. */
export function ProfileCompletionForm({ phone, capabilities, busy, initialName = '', onSubmit }: Props) {
  const [fullName, setFullName] = useState(initialName);
  const [accepted, setAccepted] = useState(false);
  return (
    <>
      <AuthHeading title="Completa tu cuenta"
        text={`Verificamos ${phone}. Solo falta tu nombre para crear tu cuenta.`} />
      <TextField label="Tu nombre" value={fullName} onChangeText={setFullName} leadingIcon="person-outline"
        helperText="Así te reconocerán durante el viaje."
        autoComplete="name" textContentType="name" maxLength={100} editable={!busy} placeholder="Nombre y apellido" />
      <TermsCheckbox termsText={capabilities?.termsText} checked={accepted} onChange={setAccepted} disabled={busy} />
      <Button title="Crear cuenta" loading={busy} disabled={!accepted || fullName.trim().length < 2}
        onPress={() => onSubmit({ fullName, termsVersion: capabilities?.termsVersion })} />
    </>
  );
}
