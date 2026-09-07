import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import test from 'node:test';

import { coloresClaros, coloresOscuros, resolverModoTema } from '../src/core/theme/tokens.ts';

const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (context.parentURL?.endsWith('/crearStoreTema.ts') && specifier.startsWith('.')) {
      return { url: new URL(`${specifier}.ts`, context.parentURL).href, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
});
const { crearStoreTema } = await import('../src/core/theme/crearStoreTema.ts');
hooks.deregister();

const pendiente = () => {
  let resolver;
  const promesa = new Promise((resolve) => { resolver = resolve; });
  return { promesa, resolver };
};

test('el tema predeterminado es claro y solo una elección oscura válida lo cambia', async () => {
  for (const valor of [null, undefined, 'system', 'automatic', 'corrupto', 'light', 'dark']) {
    const store = crearStoreTema({ leer: async () => valor, guardar: async () => {} });
    assert.equal(store.getState().modo, 'light');
    await store.getState().cargar();
    assert.equal(store.getState().modo, valor === 'dark' ? 'dark' : 'light');
    assert.equal(store.getState().cargado, true);
    assert.equal(resolverModoTema(valor), store.getState().modo);
  }
});

test('la elección se aplica y se restaura al crear una nueva sesión de la app', async () => {
  let valor = null;
  const almacen = { leer: async () => valor, guardar: async (modo) => { valor = modo; } };
  const store = crearStoreTema(almacen);
  await store.getState().cargar();
  await store.getState().elegir('dark');
  const reiniciado = crearStoreTema(almacen);
  await reiniciado.getState().cargar();
  assert.equal(reiniciado.getState().modo, 'dark');
  await reiniciado.getState().elegir('light');
  assert.equal(valor, 'light');
});

test('una lectura pendiente no pisa la elección más reciente', async () => {
  const lectura = pendiente();
  let consultas = 0;
  const store = crearStoreTema({ leer: () => { consultas += 1; return lectura.promesa; }, guardar: async () => {} });
  const inicio = store.getState().cargar();
  assert.equal(store.getState().cargar(), inicio);
  await store.getState().elegir('dark');
  lectura.resolver('light');
  await inicio;
  assert.equal(consultas, 1);
  assert.equal(store.getState().modo, 'dark');
});

test('un fallo de lectura permite usar claro y guardar una elección nueva', async () => {
  const store = crearStoreTema({ leer: async () => { throw new Error('Sin almacenamiento'); }, guardar: async () => {} });
  await store.getState().cargar();
  assert.equal(store.getState().cargado, true);
  assert.equal(store.getState().modo, 'light');
  assert.ok(store.getState().error);
  await store.getState().elegir('dark');
  assert.equal(store.getState().error, null);
});

test('una lectura bloqueada se libera a los cinco segundos y descarta su resultado tardío', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const lectura = pendiente();
  const store = crearStoreTema({ leer: () => lectura.promesa, guardar: async () => {} });
  const inicio = store.getState().cargar();
  t.mock.timers.tick(5_001);
  await inicio;
  assert.equal(store.getState().cargado, true);
  assert.equal(store.getState().modo, 'light');
  lectura.resolver('dark');
  await Promise.resolve();
  assert.equal(store.getState().modo, 'light');
});

test('un fallo al guardar conserva el tema aplicado y permite reintentar', async () => {
  let intentos = 0;
  const store = crearStoreTema({
    leer: async () => null,
    guardar: async () => { if (++intentos === 1) throw new Error('No se pudo guardar'); },
  });
  await store.getState().elegir('dark');
  assert.equal(store.getState().modo, 'dark');
  assert.equal(store.getState().guardando, false);
  assert.ok(store.getState().error);
  await store.getState().elegir('dark');
  assert.equal(store.getState().error, null);
  assert.equal(intentos, 2);
});

test('guardar bloquea cambios simultáneos hasta persistir la selección', async () => {
  const escritura = pendiente(), guardados = [];
  const store = crearStoreTema({ leer: async () => null, guardar: (modo) => { guardados.push(modo); return escritura.promesa; } });
  const primera = store.getState().elegir('dark');
  assert.equal(store.getState().modo, 'dark');
  assert.equal(store.getState().guardando, true);
  await store.getState().elegir('light');
  assert.deepEqual(guardados, ['dark']);
  escritura.resolver();
  await primera;
  assert.equal(store.getState().guardando, false);
});

function luminancia(hex) {
  const rgb = hex.slice(1).match(/../g).map((parte) => parseInt(parte, 16) / 255)
    .map((valor) => valor <= 0.04045 ? valor / 12.92 : ((valor + 0.055) / 1.055) ** 2.4);
  return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
}

test('ambas paletas conservan contraste de texto y controles', () => {
  const pares = [
    ['text', 'background', 4.5], ['text', 'surface', 4.5], ['textSecondary', 'surfaceMuted', 4.5],
    ['primary', 'primarioSuave', 4.5], ['textOnPrimary', 'primary', 4.5],
    ['textOnPrimary', 'danger', 4.5], ['textOnPrimary', 'success', 4.5],
    ['danger', 'peligroSuave', 4.5], ['success', 'exitoSuave', 4.5], ['aviso', 'avisoSuave', 4.5],
    ['placeholder', 'surface', 4.5], ['textoSobreAcento', 'accent', 4.5],
    ['bordeControl', 'surface', 3], ['bordeControl', 'surfaceMuted', 3],
  ];
  for (const [nombre, paleta] of Object.entries({ claro: coloresClaros, oscuro: coloresOscuros })) {
    for (const [texto, fondo, minimo] of pares) {
      const a = luminancia(paleta[texto]), b = luminancia(paleta[fondo]);
      const contraste = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
      assert.ok(contraste >= minimo, `${nombre}: ${texto}/${fondo} tiene contraste ${contraste.toFixed(2)}`);
    }
  }
});
