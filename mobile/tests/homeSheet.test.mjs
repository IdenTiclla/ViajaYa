import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import test from 'node:test';

// Resolve the `@/` alias to the TypeScript sources (node strips the types).
const hooks = registerHooks({
  resolve(specifier, context, next) {
    if (specifier.startsWith('@/')) {
      return next(new URL(`../src/${specifier.slice(2)}.ts`, import.meta.url).href, context);
    }
    return next(specifier, context);
  },
});
const { buildSavedPlaceShortcuts } = await import(
  '../src/features/home/domain/savedPlaceShortcuts.ts'
);
const { homeSheetLayout } = await import('../src/features/home/presentation/homeSheetLayout.ts');
hooks.deregister();

const place = (id, category, label) => ({
  id,
  label,
  category,
  place: { name: label, address: '', coordinates: { latitude: -17.39, longitude: -66.15 } },
});

test('Casa and Trabajo always lead the shortcuts, pending when not saved', () => {
  const shortcuts = buildSavedPlaceShortcuts([]);
  assert.deepEqual(
    shortcuts.map((s) => [s.kind, s.kind === 'unset' ? s.category : s.place.id]),
    [['unset', 'home'], ['unset', 'work']],
  );
});

test('saved Casa/Trabajo are used and the other favorites follow in API order', () => {
  const places = [
    place('g', 'gym', 'Gimnasio'),
    place('w', 'work', 'Oficina'),
    place('o', 'other', 'Universidad'),
    place('h', 'home', 'Casa'),
    place('h2', 'home', 'Casa de mamá'),
  ];
  const shortcuts = buildSavedPlaceShortcuts(places);
  assert.deepEqual(
    shortcuts.map((s) => (s.kind === 'saved' ? s.place.id : `unset-${s.category}`)),
    ['h', 'w', 'g', 'o', 'h2'],
  );
});

test('collapsed shows up to the saved places and expanding reveals the rest', () => {
  assert.deepEqual(
    homeSheetLayout({ collapsedContent: 420, fullContent: 610, maxHeight: 760 }),
    { height: 610, peek: 420 },
  );
});

test('without more content the sheet does not expand', () => {
  assert.deepEqual(
    homeSheetLayout({ collapsedContent: 420, fullContent: 420, maxHeight: 760 }),
    { height: 420, peek: 420 },
  );
});

test('the sheet never exceeds the available height', () => {
  assert.deepEqual(
    homeSheetLayout({ collapsedContent: 500, fullContent: 900, maxHeight: 460 }),
    { height: 460, peek: 460 },
  );
});
