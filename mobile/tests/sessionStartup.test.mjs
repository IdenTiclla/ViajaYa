import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import test from 'node:test';

const mocks = {
  '@/core/http/tokenStorage': `export const tokenStorage = {
    async get() { return { accessToken: 'anterior', refreshToken: 'válido' }; },
    async save() {}, async clear() {},
  };`,
  '@/core/http/client': `export let expired;
    export const api = { async post() {} };
    export function setOnSessionExpired(fn) { expired = fn; }
    export function invalidarSolicitudesSesion() {}`,
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

test('un fallo nativo al leer la sesión termina la carga y permite reintentar', async (t) => {
  const get = tokenStorage.get;
  t.after(() => { tokenStorage.get = get; });
  tokenStorage.get = async () => { throw new Error('No se pudo leer la sesión'); };
  await useAuthStore.getState().bootstrap();
  assert.equal(useAuthStore.getState().status, 'error');
  assert.match(useAuthStore.getState().startupError, /leer la sesión/);
  tokenStorage.get = get;
  await useAuthStore.getState().bootstrap();
  assert.equal(useAuthStore.getState().status, 'authenticated');
});

test('el arranque sin red conserva credenciales para otro intento', async (t) => {
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

test('un arranque bloqueado vence y una respuesta vieja no pisa la sesión nueva', async (t) => {
  const me = authRepository.me;
  t.after(() => { authRepository.me = me; });
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let resolver;
  authRepository.me = () => new Promise((resolve) => { resolver = resolve; });
  const intento = useAuthStore.getState().bootstrap();
  await Promise.resolve();
  t.mock.timers.tick(30_000);
  await intento;
  assert.equal(useAuthStore.getState().status, 'error');
  authRepository.me = async () => ({ id: 'nuevo' });
  await useAuthStore.getState().bootstrap();
  resolver({ id: 'anterior' });
  await Promise.resolve();
  assert.equal(useAuthStore.getState().user.id, 'nuevo');
});

test('una respuesta de arranque no restaura una sesión que ya venció', async (t) => {
  const me = authRepository.me;
  t.after(() => { authRepository.me = me; });
  authRepository.me = async () => { expired(); return { id: 'anterior' }; };
  await useAuthStore.getState().bootstrap();
  assert.equal(useAuthStore.getState().status, 'unauthenticated');
  assert.equal(useAuthStore.getState().user, null);
});

test('salir de la recuperación lleva al login aunque falle el borrado nativo', async (t) => {
  t.mock.method(tokenStorage, 'clear', async () => { throw new Error('Almacenamiento inaccesible'); });
  useAuthStore.setState({ status: 'error', user: null, startupError: 'Sin conexión' });
  await useAuthStore.getState().signOut();
  assert.equal(useAuthStore.getState().status, 'unauthenticated');
  assert.equal(useAuthStore.getState().startupError, null);
});

test('salir descarta una restauración pendiente que responde después', async (t) => {
  let resolver;
  t.mock.method(authRepository, 'me', () => new Promise((resolve) => { resolver = resolve; }));
  const arranque = useAuthStore.getState().bootstrap();
  await Promise.resolve();
  await useAuthStore.getState().signOut();
  resolver({ id: 'anterior' });
  await arranque;
  assert.equal(useAuthStore.getState().status, 'unauthenticated');
  assert.equal(useAuthStore.getState().user, null);
});
