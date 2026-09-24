/** Persist one installation identifier without collecting a hardware identifier. */
import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';

import { withTimeout } from '@/core/async/conTiempoLimite';

let pending: Promise<string> | null = null;
export function getInstallationId(): Promise<string> {
  if (!pending) {
    pending = withTimeout((async () => {
      const saved = await SecureStore.getItemAsync('viajaya.installationId');
      if (saved && /^[0-9a-f-]{36}$/i.test(saved)) return saved;
      const value = Crypto.randomUUID();
      await SecureStore.setItemAsync('viajaya.installationId', value);
      return value;
    })(), 5_000, 'No pudimos preparar este teléfono. Vuelve a intentar.')
      .catch((error: unknown) => { pending = null; throw error; });
  }
  return pending;
}
