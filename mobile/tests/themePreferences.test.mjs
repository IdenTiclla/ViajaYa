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

const pending = () => {
  let release;
  const promise = new Promise((resolve) => { release = resolve; });
  return { promise, release };
};

test('the default theme is light and only a valid dark choice changes it', async () => {
  for (const value of [null, undefined, 'system', 'automatic', 'corrupto', 'light', 'dark']) {
    const store = createThemeStore({ read: async () => value, save: async () => {} });
    assert.equal(store.getState().mode, 'light');
    await store.getState().load();
    assert.equal(store.getState().mode, value === 'dark' ? 'dark' : 'light');
    assert.equal(store.getState().loaded, true);
    assert.equal(resolveThemeMode(value), store.getState().mode);
  }
});

test('the choice is applied and restored when creating a new app session', async () => {
  let value = null;
  const storage = { read: async () => value, save: async (themeMode) => { value = themeMode; } };
  const store = createThemeStore(storage);
  await store.getState().load();
  await store.getState().choose('dark');
  const restarted = createThemeStore(storage);
  await restarted.getState().load();
  assert.equal(restarted.getState().mode, 'dark');
  await restarted.getState().choose('light');
  assert.equal(value, 'light');
});

test('a pending read does not overwrite the most recent choice', async () => {
  const pendingRead = pending();
  let queries = 0;
  const store = createThemeStore({ read: () => { queries += 1; return pendingRead.promise; }, save: async () => {} });
  const start = store.getState().load();
  assert.equal(store.getState().load(), start);
  await store.getState().choose('dark');
  pendingRead.release('light');
  await start;
  assert.equal(queries, 1);
  assert.equal(store.getState().mode, 'dark');
});

test('a read failure allows using light and saving a new choice', async () => {
  const store = createThemeStore({ read: async () => { throw new Error('No storage'); }, save: async () => {} });
  await store.getState().load();
  assert.equal(store.getState().loaded, true);
  assert.equal(store.getState().mode, 'light');
  assert.ok(store.getState().error);
  await store.getState().choose('dark');
  assert.equal(store.getState().error, null);
});

test('a blocked read is released after five seconds and discards its late result', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const pendingRead = pending();
  const store = createThemeStore({ read: () => pendingRead.promise, save: async () => {} });
  const start = store.getState().load();
  t.mock.timers.tick(5_001);
  await start;
  assert.equal(store.getState().loaded, true);
  assert.equal(store.getState().mode, 'light');
  pendingRead.release('dark');
  await Promise.resolve();
  assert.equal(store.getState().mode, 'light');
});

test('a save failure keeps the applied theme and allows retrying', async () => {
  let attempts = 0;
  const store = createThemeStore({
    read: async () => null,
    save: async () => { if (++attempts === 1) throw new Error('No se pudo guardar'); },
  });
  await store.getState().choose('dark');
  assert.equal(store.getState().mode, 'dark');
  assert.equal(store.getState().saving, false);
  assert.ok(store.getState().error);
  await store.getState().choose('dark');
  assert.equal(store.getState().error, null);
  assert.equal(attempts, 2);
});

test('saving blocks simultaneous changes until the selection is persisted', async () => {
  const write = pending(), saved = [];
  const store = createThemeStore({ read: async () => null, save: (themeMode) => { saved.push(themeMode); return write.promise; } });
  const first = store.getState().choose('dark');
  assert.equal(store.getState().mode, 'dark');
  assert.equal(store.getState().saving, true);
  await store.getState().choose('light');
  assert.deepEqual(saved, ['dark']);
  write.release();
  await first;
  assert.equal(store.getState().saving, false);
});

function luminancia(hex) {
  const rgb = hex.slice(1).match(/../g).map((part) => parseInt(part, 16) / 255)
    .map((value) => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
  return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
}

test('both palettes keep text and control contrast', () => {
  const pares = [
    ['text', 'background', 4.5], ['text', 'surface', 4.5], ['textSecondary', 'surfaceMuted', 4.5],
    ['primary', 'primarySoft', 4.5], ['textOnPrimary', 'primary', 4.5],
    ['textOnPrimary', 'danger', 4.5], ['textOnPrimary', 'success', 4.5],
    ['danger', 'dangerSoft', 4.5], ['success', 'successSoft', 4.5], ['warning', 'warningSoft', 4.5],
    ['placeholder', 'surface', 4.5], ['textOnAccent', 'accent', 4.5],
    ['controlBorder', 'surface', 3], ['controlBorder', 'surfaceMuted', 3],
  ];
  for (const [name, palette] of Object.entries({ light: lightColors, dark: darkColors })) {
    for (const [text, background, minimum] of pares) {
      const a = luminancia(palette[text]), b = luminancia(palette[background]);
      const contrast = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
      assert.ok(contrast >= minimum, `${name}: ${text}/${background} tiene contraste ${contrast.toFixed(2)}`);
    }
  }
});
