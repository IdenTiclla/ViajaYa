import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import test from 'node:test';

import { lightColors, darkColors, resolveThemeMode } from '../src/core/theme/tokens.ts';

const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (context.parentURL?.endsWith('/createThemeStore.ts') && specifier.startsWith('.')) {
      return { url: new URL(`${specifier}.ts`, context.parentURL).href, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
});
const { createThemeStore } = await import('../src/core/theme/createThemeStore.ts');
hooks.deregister();

const pendiente = () => {
  let resolver;
  const promesa = new Promise((resolve) => { resolver = resolve; });
  return { promesa, resolver };
};

test('el tema predeterminado es claro y solo una elección oscura válida lo cambia', async () => {
  for (const valor of [null, undefined, 'system', 'automatic', 'corrupto', 'light', 'dark']) {
    const store = createThemeStore({ read: async () => valor, save: async () => {} });
    assert.equal(store.getState().mode, 'light');
    await store.getState().load();
    assert.equal(store.getState().mode, valor === 'dark' ? 'dark' : 'light');
    assert.equal(store.getState().loaded, true);
    assert.equal(resolveThemeMode(valor), store.getState().mode);
  }
});

test('la elección se aplica y se restaura al crear una nueva sesión de la app', async () => {
  let valor = null;
  const almacen = { read: async () => valor, save: async (modo) => { valor = modo; } };
  const store = createThemeStore(almacen);
  await store.getState().load();
  await store.getState().choose('dark');
  const reiniciado = createThemeStore(almacen);
  await reiniciado.getState().load();
  assert.equal(reiniciado.getState().mode, 'dark');
  await reiniciado.getState().choose('light');
  assert.equal(valor, 'light');
});

test('una lectura pendiente no pisa la elección más reciente', async () => {
  const lectura = pendiente();
  let consultas = 0;
  const store = createThemeStore({ read: () => { consultas += 1; return lectura.promesa; }, save: async () => {} });
  const inicio = store.getState().load();
  assert.equal(store.getState().load(), inicio);
  await store.getState().choose('dark');
  lectura.resolver('light');
  await inicio;
  assert.equal(consultas, 1);
  assert.equal(store.getState().mode, 'dark');
});

test('un fallo de lectura permite usar claro y guardar una elección nueva', async () => {
  const store = createThemeStore({ read: async () => { throw new Error('Sin almacenamiento'); }, save: async () => {} });
  await store.getState().load();
  assert.equal(store.getState().loaded, true);
  assert.equal(store.getState().mode, 'light');
  assert.ok(store.getState().error);
  await store.getState().choose('dark');
  assert.equal(store.getState().error, null);
});

test('una lectura bloqueada se libera a los cinco segundos y descarta su resultado tardío', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const lectura = pendiente();
  const store = createThemeStore({ read: () => lectura.promesa, save: async () => {} });
  const inicio = store.getState().load();
  t.mock.timers.tick(5_001);
  await inicio;
  assert.equal(store.getState().loaded, true);
  assert.equal(store.getState().mode, 'light');
  lectura.resolver('dark');
  await Promise.resolve();
  assert.equal(store.getState().mode, 'light');
});

test('un fallo al guardar conserva el tema aplicado y permite reintentar', async () => {
  let intentos = 0;
  const store = createThemeStore({
    read: async () => null,
    save: async () => { if (++intentos === 1) throw new Error('No se pudo guardar'); },
  });
  await store.getState().choose('dark');
  assert.equal(store.getState().mode, 'dark');
  assert.equal(store.getState().saving, false);
  assert.ok(store.getState().error);
  await store.getState().choose('dark');
  assert.equal(store.getState().error, null);
  assert.equal(intentos, 2);
});

test('guardar bloquea cambios simultáneos hasta persistir la selección', async () => {
  const escritura = pendiente(), guardados = [];
  const store = createThemeStore({ read: async () => null, save: (modo) => { guardados.push(modo); return escritura.promesa; } });
  const primera = store.getState().choose('dark');
  assert.equal(store.getState().mode, 'dark');
  assert.equal(store.getState().saving, true);
  await store.getState().choose('light');
  assert.deepEqual(guardados, ['dark']);
  escritura.resolver();
  await primera;
  assert.equal(store.getState().saving, false);
});

function luminancia(hex) {
  const rgb = hex.slice(1).match(/../g).map((parte) => parseInt(parte, 16) / 255)
    .map((valor) => valor <= 0.04045 ? valor / 12.92 : ((valor + 0.055) / 1.055) ** 2.4);
  return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
}

test('ambas paletas conservan contraste de texto y controles', () => {
  const pares = [
    ['text', 'background', 4.5], ['text', 'surface', 4.5], ['textSecondary', 'surfaceMuted', 4.5],
    ['primary', 'primarySoft', 4.5], ['textOnPrimary', 'primary', 4.5],
    ['textOnPrimary', 'danger', 4.5], ['textOnPrimary', 'success', 4.5],
    ['danger', 'dangerSoft', 4.5], ['success', 'successSoft', 4.5], ['warning', 'warningSoft', 4.5],
    ['placeholder', 'surface', 4.5], ['textOnAccent', 'accent', 4.5],
    ['controlBorder', 'surface', 3], ['controlBorder', 'surfaceMuted', 3],
  ];
  for (const [nombre, paleta] of Object.entries({ claro: lightColors, oscuro: darkColors })) {
    for (const [texto, fondo, minimo] of pares) {
      const a = luminancia(paleta[texto]), b = luminancia(paleta[fondo]);
      const contraste = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
      assert.ok(contraste >= minimo, `${nombre}: ${texto}/${fondo} tiene contraste ${contraste.toFixed(2)}`);
    }
  }
});
