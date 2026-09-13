import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import test from 'node:test';
import { Children, createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ts from 'typescript';

import { StackRouter } from '../node_modules/expo-router/build/react-navigation/routers/StackRouter.js';

// Render the real layout and use Expo's stack state machine. Only native UI and IO are mocked.
const mocks = {
  'expo-router': `
    export const stacks = [];
    export function Stack(props) { stacks.push(props); return null; }
    Stack.Screen = () => null;
    export function useGlobalSearchParams() { return {}; }
  `,
  '@/features/booking/presentation/PassengerToaster':
    'export function PassengerToaster() { return null; }',
  '@/features/rides/application/useNegotiationSocket':
    'export function useNegotiationSocket() {}',
  '@/features/rides/application/useRides':
    'export function usePassengerActiveRide() { return { ride: null }; }',
};
const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier in mocks) return { url: `navigation-test:${specifier}`, shortCircuit: true };
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url.startsWith('navigation-test:')) return {
      format: 'module', shortCircuit: true, source: mocks[url.slice('navigation-test:'.length)],
    };
    if (url.endsWith('.tsx')) return {
      format: 'module', shortCircuit: true,
      source: ts.transpileModule(readFileSync(new URL(url), 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX },
        fileName: url,
      }).outputText,
    };
    return nextLoad(url, context);
  },
});
const { default: PassengerLayout } = await import('../src/app/(app)/_layout.tsx');
const { stacks } = await import('expo-router');
hooks.deregister();

function passengerNavigator() {
  stacks.length = 0;
  renderToStaticMarkup(createElement(PassengerLayout));
  const props = stacks[0];
  const screens = Children.toArray(props.children);
  // Expo places explicitly configured screens before implicitly discovered routes.
  const routeNames = [...new Set([...screens.map((screen) => screen.props.name), '(tabs)'])];
  const options = { routeNames, routeParamList: {}, routeGetIdList: {} };
  const router = StackRouter({ initialRouteName: props.initialRouteName });
  return { router, options, state: router.getInitialState(options) };
}

test('a fresh passenger session opens home without requiring a ride identifier', () => {
  const { state } = passengerNavigator();
  assert.equal(state.routes[state.index].name, '(tabs)');
  assert.equal(state.routes[state.index].params?.rideId, undefined);
});

test('opening an existing ride keeps its identifier and a home destination underneath', () => {
  const { router, options, state } = passengerNavigator();
  const rideId = '9f5cb93e-6e13-4414-a053-91b9f6a0fa2b';
  for (const name of ['booking/offers', 'booking/trip', 'booking/rating']) {
    const opened = router.getStateForAction(state, {
      type: 'PUSH', payload: { name, params: { rideId } },
    }, options);
    assert.equal(opened.routes[opened.index].name, name);
    assert.equal(opened.routes[opened.index].params.rideId, rideId);
    assert.equal(opened.routes[0].name, '(tabs)');
  }
});
