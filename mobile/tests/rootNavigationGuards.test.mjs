import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

// When a protected group closes (e.g. `(auth)` right after sign-in), Expo's stack falls
// back to the first screen whose guard allows it. `choose-mode` is declared first, so its
// guard must include the pending choice or every plain passenger lands on it.
const layout = readFileSync(new URL('../src/app/_layout.tsx', import.meta.url), 'utf8');

test('the mode chooser is only mounted while a mode choice is pending', () => {
  const guard = layout.match(
    /<Stack\.Protected guard=\{([^}]+)\}>\s*<Stack\.Screen name="choose-mode"/,
  );
  assert.ok(guard, 'choose-mode must be wrapped in its own Stack.Protected');
  assert.match(guard[1], /modeChoicePending/);
});
