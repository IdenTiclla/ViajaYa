import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import test from 'node:test';

const mocks = {
  '@/core/http/tokenStorage': `export const tokenStorage = {
    async get() { return { accessToken: 'previous', refreshToken: 'válido' }; },
    async save() {}, async clear() {},
  };`,
  '@/core/http/client': `export let expired;
    export const api = { async post() {} };
    export function setOnSessionExpired(fn) { expired = fn; }
    export function invalidateSessionRequests() {}`,
  '@/features/auth/data/authRepository': `export const authRepository = {
    async me() { return { id: 'pasajero' }; },
  };`,
};
const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier in mocks) return { url: `prueba:${specifier}`, shortCircuit: true };
    if (specifier.startsWith('@/')) {
      return { url: new URL(`../src/${specifier.slice(2)}.ts`, import.meta.url).href,
        shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url.startsWith('prueba:')) return {
      format: 'module', shortCircuit: true, source: mocks[url.slice(7)],
    };
    return nextLoad(url, context);
  },
});
const { useAuthStore } = await import('../src/store/authStore.ts');
const { tokenStorage } = await import('@/core/http/tokenStorage');
const { authRepository } = await import('@/features/auth/data/authRepository');
const { expired } = await import('@/core/http/client');
hooks.deregister();

test('a native failure reading the session ends loading and allows retrying', async (t) => {
  const get = tokenStorage.get;
  t.after(() => { tokenStorage.get = get; });
  tokenStorage.get = async () => { throw new Error('Could not read the session'); };
  await useAuthStore.getState().bootstrap();
  assert.equal(useAuthStore.getState().status, 'error');
  assert.match(useAuthStore.getState().startupError, /read the session/);
  tokenStorage.get = get;
  await useAuthStore.getState().bootstrap();
  assert.equal(useAuthStore.getState().status, 'authenticated');
});

test('starting without network keeps credentials for another attempt', async (t) => {
  const me = authRepository.me;
  t.after(() => { authRepository.me = me; });
  const clear = t.mock.method(tokenStorage, 'clear');
  authRepository.me = async () => { throw new Error('Sin conexión'); };
  await useAuthStore.getState().bootstrap();
  assert.equal(useAuthStore.getState().status, 'error');
  assert.equal(clear.mock.callCount(), 0);
  authRepository.me = me;
  await useAuthStore.getState().bootstrap();
  assert.equal(useAuthStore.getState().status, 'authenticated');
});

test('a blocked startup times out and an old response does not overwrite the new session', async (t) => {
  const me = authRepository.me;
  t.after(() => { authRepository.me = me; });
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let release;
  authRepository.me = () => new Promise((resolve) => { release = resolve; });
  const attempt = useAuthStore.getState().bootstrap();
  await Promise.resolve();
  t.mock.timers.tick(30_000);
  await attempt;
  assert.equal(useAuthStore.getState().status, 'error');
  authRepository.me = async () => ({ id: 'nuevo' });
  await useAuthStore.getState().bootstrap();
  release({ id: 'anterior' });
  await Promise.resolve();
  assert.equal(useAuthStore.getState().user.id, 'nuevo');
});

test('a startup response does not restore a session that already expired', async (t) => {
  const me = authRepository.me;
  t.after(() => { authRepository.me = me; });
  authRepository.me = async () => { expired(); return { id: 'anterior' }; };
  await useAuthStore.getState().bootstrap();
  assert.equal(useAuthStore.getState().status, 'unauthenticated');
  assert.equal(useAuthStore.getState().user, null);
});

test('leaving recovery goes to login even if the native deletion fails', async (t) => {
  t.mock.method(tokenStorage, 'clear', async () => { throw new Error('Almacenamiento inaccesible'); });
  useAuthStore.setState({ status: 'error', user: null, startupError: 'Sin conexión' });
  await useAuthStore.getState().signOut();
  assert.equal(useAuthStore.getState().status, 'unauthenticated');
  assert.equal(useAuthStore.getState().startupError, null);
});

test('leaving discards a pending restore that answers later', async (t) => {
  let release;
  t.mock.method(authRepository, 'me', () => new Promise((resolve) => { release = resolve; }));
  const startup = useAuthStore.getState().bootstrap();
  await Promise.resolve();
  await useAuthStore.getState().signOut();
  release({ id: 'anterior' });
  await startup;
  assert.equal(useAuthStore.getState().status, 'unauthenticated');
  assert.equal(useAuthStore.getState().user, null);
});
