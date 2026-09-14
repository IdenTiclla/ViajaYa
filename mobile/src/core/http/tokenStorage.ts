/** Keep session credentials in the platform's encrypted store. */
import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';

import { createSecureSessionStorage } from './secureSessionStorage';

export type { TokenPair } from './secureSessionStorage';
export const tokenStorage = createSecureSessionStorage(SecureStore, Crypto.randomUUID);
