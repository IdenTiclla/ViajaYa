import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import test from 'node:test';

const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === 'expo-secure-store') return { url: 'prueba:secure-store', shortCircuit: true };
    if (specifier === '@/core/async/conTiempoLimite') return {
      url: new URL('../src/core/async/conTiempoLimite.ts', import.meta.url).href,
      shortCircuit: true,
    };
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url === 'prueba:secure-store') return {
      format: 'module', shortCircuit: true, source: `
        export const nativo = { leer: async () => 'token', borrar: async () => {} };
        export const getItemAsync = (key) => nativo.leer(key);
        export const deleteItemAsync = (key) => nativo.borrar(key);
      `,
    };
    return nextLoad(url, context);
  },
});
const { tokenStorage } = await import('../src/core/http/tokenStorage.ts');
const { nativo } = await import('expo-secure-store');
hooks.deregister();

test('SecureStore bloqueado termina la espera y permite una lectura posterior', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  nativo.leer = () => new Promise(() => {});
  const pendiente = assert.rejects(tokenStorage.get(), /No pudimos leer tu sesión/);
  t.mock.timers.tick(5_000);
  await pendiente;
  nativo.leer = async () => 'recuperado';
  assert.deepEqual(await tokenStorage.get(), {
    accessToken: 'recuperado', refreshToken: 'recuperado',
  });
});

test('una credencial incompleta se trata como ausencia de sesión', async () => {
  nativo.leer = async (key) => key.endsWith('accessToken') ? 'token' : null;
  assert.equal(await tokenStorage.get(), null);
});

test('el borrado nativo bloqueado tiene un límite de espera', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  t.mock.method(nativo, 'borrar', () => new Promise(() => {}));
  const pendiente = assert.rejects(tokenStorage.clear(), /eliminar la sesión/);
  t.mock.timers.tick(5_000);
  await pendiente;
});
