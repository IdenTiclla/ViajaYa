import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { registerHooks } from 'node:module';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ts from 'typescript';

// The production components are rendered; only the native views are replaced.
// These tests check their props, not the real Android bitmap.
const doubles = {
  'react-native-maps': `
    export const lines = [], markers = [];
    export function Polyline(props) { lines.push(props); return null; }
    export function Marker(props) { markers.push(props); return props.children; }
  `,
  'react-native': `
    export const views = [], texts = [];
    function flatten(style) {
      return Array.isArray(style) ? Object.assign({}, ...style.map(flatten)) : style || {};
    }
    export const StyleSheet = { create: (styles) => styles };
    export function View(props) {
      views.push({ ...props, style: flatten(props.style) }); return props.children;
    }
    export function Text(props) {
      texts.push({ ...props, style: flatten(props.style) }); return props.children;
    }
  `,
  '@react-native-vector-icons/ionicons': 'export function Ionicons() { return null; }',
  '@/shared/components': 'export function PinLoadingIndicator() { return null; }',
  '@/shared/components/PinLoadingIndicator': 'export function PinLoadingIndicator() { return null; }',
};
const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier in doubles) return { url: `prueba:${specifier}`, shortCircuit: true };
    if (specifier === '@/core/theme') return {
      url: new URL('../src/core/theme/index.ts', import.meta.url).href, shortCircuit: true,
    };
    if (specifier.startsWith('@/shared/components/map/')) return {
      url: new URL(`../src/${specifier.slice(2)}.tsx`, import.meta.url).href,
      shortCircuit: true,
    };
    if (context.parentURL?.includes('/core/theme/') && specifier.startsWith('.')) return {
      url: new URL(`${specifier}.ts`, context.parentURL).href, shortCircuit: true,
    };
    if (specifier === '@/features/rides/presentation/routeTooltipLayout') return {
      url: new URL('../src/features/rides/presentation/routeTooltipLayout.ts', import.meta.url).href,
      shortCircuit: true,
    };
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url.startsWith('prueba:')) return {
      format: 'module', shortCircuit: true, source: doubles[url.slice(7)],
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
const { RoutePolyline } = await import('../src/features/rides/presentation/RoutePolyline.tsx');
const { RoutePinMarker } = await import('../src/features/rides/presentation/RoutePinMarker.tsx');
const { ThemeContext } = await import('../src/core/theme/useTheme.ts');
const { getTheme } = await import('../src/core/theme/tokens.ts');
const { useMapStyle } = await import('../src/features/booking/presentation/mapStyle.ts');
const { lines, markers } = await import('react-native-maps');
const { views, texts } = await import('react-native');
hooks.deregister();

const origin = { latitude: -16.51, longitude: -68.15 };
const destination = { latitude: -16.50, longitude: -68.15 };
const routePoints = [origin, destination];

test('map and route follow the chosen theme without changing place visibility', () => {
  let styleValue;
  function MapProbe({ hide }) {
    styleValue = useMapStyle(hide);
    return createElement(RoutePolyline, { coordinates: routePoints });
  }
  for (const mode of ['light', 'dark']) {
    for (const hide of [true, false]) {
      lines.length = 0;
      const theme = getTheme(mode);
      renderToStaticMarkup(createElement(ThemeContext.Provider, { value: theme }, createElement(MapProbe, { hide })));
      assert.equal(styleValue.mapMode, mode);
      assert.equal(styleValue.mapStyle[0].stylers[0].color, theme.colors.mapLand);
      assert.deepEqual(lines.map((line) => line.strokeColor), [theme.colors.surface, theme.colors.primary]);
      assert.equal(styleValue.mapStyle.some((styleRule) => styleRule.featureType === 'poi' && styleRule.elementType === 'labels'
        && styleRule.stylers.some((attrValue) => attrValue.visibility === 'off')), hide);
      for (const feature of ['landscape.man_made', 'landscape.natural.terrain', 'poi']) {
        assert.deepEqual(styleValue.mapStyle.find(rule => rule.featureType === feature
          && rule.elementType === 'geometry').stylers, [{ visibility: 'off' }]);
      }
      assert.deepEqual(styleValue.mapStyle.find(rule => rule.featureType === 'poi.park'
        && rule.elementType === 'geometry').stylers, [{ visibility: 'on' }, { color: theme.colors.mapPark }]);
      assert.deepEqual(lines.map((line) => line.strokeWidth), [5, 3]);
    }
  }
});

test('the shared route draws a thin stroke of 3 and an outline of 5', () => {
  lines.length = 0;
  renderToStaticMarkup(createElement(RoutePolyline, { coordinates: routePoints }));
  assert.equal(lines.length, 2);
  assert.deepEqual(lines.map((line) => line.strokeWidth), [5, 3]);
  assert.deepEqual(lines.map((line) => line.zIndex), [1, 2]);
  assert.ok(lines.every((line) => line.coordinates === routePoints));
});

test('an empty or single-point route leaves no stray strokes', () => {
  for (const coordinates of [[], [origin]]) {
    lines.length = 0;
    renderToStaticMarkup(createElement(RoutePolyline, { coordinates }));
    assert.equal(lines.length, 0);
  }
});

test('A and B keep size and typography when editing, loading or hiding the tooltip', () => {
  for (const kind of ['A', 'B']) {
    for (const variant of [{}, { showEditControl: true }, { loading: true }, { showTooltip: false }]) {
      views.length = texts.length = markers.length = 0;
      renderToStaticMarkup(createElement(RoutePinMarker, {
        kind, coordinate: kind === 'A' ? origin : destination,
        label: 'Una dirección larga que ocupa más de una línea', route: routePoints, ...variant,
      }));
      const letter = texts.find((text) => text.children === kind);
      const pin = views.find((vista) => vista.style.width === 16 && vista.style.height === 16);
      assert.ok(pin, 'The pin must measure 16 in every variant');
      assert.equal(pin.style.borderWidth, 1.5);
      assert.equal(pin.style.borderRadius, 8, 'Origen y destino conservan su forma circular');
      assert.equal(letter.style.fontSize, 9);
      assert.equal(letter.style.includeFontPadding, false);
      assert.equal(letter.allowFontScaling, false, 'The symbol letter keeps the map anchor');
      assert.equal(views[0].collapsable, false, 'Keeps the full native container');
      assert.equal(markers[0].coordinate, kind === 'A' ? origin : destination);
      if (variant.showTooltip !== false) {
        const tooltip = texts.find((text) => text.numberOfLines === 2);
        assert.equal(tooltip.style.fontSize, 10, 'The label does not change size per screen');
      }
    }
  }
});

test('the pins keep their shape and update their colors in both themes', () => {
  for (const mode of ['light', 'dark']) {
    const theme = getTheme(mode);
    for (const kind of ['A', 'B']) {
      views.length = texts.length = markers.length = 0;
      renderToStaticMarkup(createElement(ThemeContext.Provider, { value: theme },
        createElement(RoutePinMarker, { kind, coordinate: origin, label: 'Punto del viaje' })));
      const pin = views.find((vista) => vista.style.width === 16 && vista.style.height === 16);
      assert.equal(pin.style.backgroundColor, kind === 'A' ? theme.colors.primary : theme.colors.danger);
      assert.equal(pin.style.borderColor, theme.colors.surface);
      assert.equal(texts.find((text) => text.children === kind).style.color, theme.colors.textOnPrimary);
      assert.equal(markers[0].accessibilityLabel, 'Punto del viaje');
    }
  }
});

test('without room for the tooltip it keeps the pin, the native title and the edit action', () => {
  views.length = texts.length = markers.length = 0;
  const edit = () => {};
  renderToStaticMarkup(createElement(RoutePinMarker, {
    kind: 'A', coordinate: origin, label: 'Origen: Calle de prueba',
    route: [{ ...origin, latitude: -17 }, { ...origin, latitude: -16 }],
    mapZoom: 15, showEditControl: true, onPress: edit,
  }));
  assert.equal(views[1].style.opacity, 0);
  assert.equal(markers[0].title, 'Origen: Calle de prueba');
  assert.equal(markers[0].onPress, edit);
  assert.ok(views.some((vista) => vista.style.width === 16 && vista.style.height === 16));
});

// Inventory all native map sites so new screens cannot silently restore
// zoom-dependent building or indoor layers in either theme.
test('every native map uses the shared style and disables buildings, interiors and tilt', () => {
  const files = [];
  function visitDirectory(directory) {
    for (const item of readdirSync(directory, { withFileTypes: true })) {
      const path = new URL(item.name + (item.isDirectory() ? '/' : ''), directory);
      if (item.isDirectory()) visitDirectory(path);
      else if (item.name.endsWith('.tsx')) files.push(path);
    }
  }
  visitDirectory(new URL('../src/', import.meta.url));
  let count = 0;
  for (const file of files) {
    const source = ts.createSourceFile(file.href, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    function visit(node) {
      if ((ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node)) && node.tagName.getText(source) === 'MapView') {
        count++;
        const attributes = new Map(node.attributes.properties.filter(ts.isJsxAttribute).map(attribute => [attribute.name.getText(source), attribute.initializer]));
        for (const prop of ['showsBuildings', 'showsIndoors', 'showsIndoorLevelPicker', 'pitchEnabled']) {
          const value = attributes.get(prop);
          assert.ok(value && ts.isJsxExpression(value) && value.expression?.kind === ts.SyntaxKind.FalseKeyword, file.pathname + ': ' + prop);
        }
        assert.equal(attributes.get('customMapStyle')?.getText(source), '{mapStyle}', file.pathname);
        assert.equal(attributes.get('userInterfaceStyle')?.getText(source), '{mapMode}', file.pathname);
      }
      ts.forEachChild(node, visit);
    }
    visit(source);
  }
  assert.ok(count >= 7, 'All passenger and driver map screens are checked');
});
