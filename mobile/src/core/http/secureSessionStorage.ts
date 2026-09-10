/** Serialize native writes and store each credential pair as one atomic value. */
export type TokenPair = {
  accessToken: string;
  refreshToken: string;
  refreshRequestId?: string;
};

type NativeStorage = {
  getItemAsync(key: string): Promise<string | null>;
  setItemAsync(key: string, value: string): Promise<void>;
  deleteItemAsync(key: string): Promise<void>;
};

const SESSION_KEY = 'viajaya.session.v2';
const ACCESS_KEY = 'viajaya.accessToken';
const REFRESH_KEY = 'viajaya.refreshToken';

export function createSecureSessionStorage(
  native: NativeStorage, randomId: () => string, timeoutMs = 5_000,
) {
  let writes: Promise<void> = Promise.resolve();
  let cleared = false;
  let generation = 0;

  function bounded<T>(pending: Promise<T>, message: string): Promise<T> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(message)), timeoutMs);
      pending.then(resolve, reject).finally(() => clearTimeout(timer));
    });
  }

  function enqueue(operation: () => Promise<void>, message: string): Promise<void> {
    const pending = writes.then(operation);
    // A native timeout must not let a late write overtake the next clear/save.
    writes = pending.catch(() => {});
    return bounded(pending, message);
  }

  const storage = {
    async get(): Promise<TokenPair | null> {
      if (cleared) return null;
      const current = generation;
      const pending = (async () => {
        await writes;
        const serialized = await native.getItemAsync(SESSION_KEY);
        if (serialized) {
          const value = JSON.parse(serialized) as Partial<TokenPair> | null;
          if (value === null) return null;
          if (typeof value.accessToken !== 'string' || typeof value.refreshToken !== 'string'
            || !value.accessToken || !value.refreshToken) {
            throw new Error('La sesión guardada está incompleta. Vuelve a iniciar sesión.');
          }
          return value as TokenPair;
        }
        const [accessToken, refreshToken] = await Promise.all([
          native.getItemAsync(ACCESS_KEY), native.getItemAsync(REFRESH_KEY),
        ]);
        return accessToken && refreshToken ? { accessToken, refreshToken } : null;
      })();
      const value = await bounded(pending, 'No pudimos leer tu sesión. Vuelve a intentar.');
      return current === generation && !cleared ? value : null;
    },

    async save(tokens: TokenPair): Promise<void> {
      const current = ++generation;
      const value = { ...tokens, refreshRequestId: tokens.refreshRequestId ?? randomId() };
      await enqueue(async () => {
        if (current !== generation) return;
        await native.setItemAsync(SESSION_KEY, JSON.stringify(value));
        if (current === generation) cleared = false;
      }, 'No pudimos guardar tu sesión. Vuelve a intentar.');
    },

    async prepareRefresh(): Promise<TokenPair | null> {
      const current = generation;
      const tokens = await storage.get();
      if (!tokens || current !== generation) return null;
      if (tokens.refreshRequestId) return tokens;
      const migrated = { ...tokens, refreshRequestId: randomId() };
      await storage.save(migrated);
      return migrated;
    },

    async clear(): Promise<void> {
      generation += 1;
      cleared = true;
      await enqueue(async () => {
        // A tombstone prevents deleted legacy credentials from restoring a session.
        await native.setItemAsync(SESSION_KEY, 'null');
        await Promise.all([native.deleteItemAsync(ACCESS_KEY), native.deleteItemAsync(REFRESH_KEY)]);
      }, 'No pudimos eliminar la sesión guardada.');
    },
  };
  return storage;
}
