import assert from 'node:assert/strict';
import test from 'node:test';

const { useTabBarVisibility } = await import('../src/core/components/tabBarVisibility.ts');

test('the bottom bar stays hidden until every full-screen view has left', () => {
  const { hide, show } = useTabBarVisibility.getState();
  assert.equal(useTabBarVisibility.getState().hiders, 0);
  hide();
  hide();
  assert.equal(useTabBarVisibility.getState().hiders, 2);
  show();
  assert.equal(useTabBarVisibility.getState().hiders > 0, true);
  show();
  assert.equal(useTabBarVisibility.getState().hiders, 0);
});

test('an extra show never leaves the counter negative', () => {
  const { show } = useTabBarVisibility.getState();
  show();
  show();
  assert.equal(useTabBarVisibility.getState().hiders, 0);
});
