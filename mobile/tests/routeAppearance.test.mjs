import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { registerHooks } from 'node:module';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ts from 'typescript';

// The production components are rendered; only the native views are replaced.
// These tests check their props, not the real Android bitmap.
const dobles = {
  'react-native-maps': `
    export const lineas = [], marcadores = [];
    export function Polyline(props) { lineas.push(props); return null; }
    export function Marker(props) { marcadores.push(props); return props.children; }
  `,
  'react-native': `
    export const vistas = [], textos = [];
    function aplanar(style) {
      return Array.isArray(style) ? Object.assign({}, ...style.map(aplanar)) : style || {};
    }
    export const StyleSheet = { create: (styles) => styles };
    export function View(props) {
      vistas.push({ ...props, style: aplanar(props.style) }); return props.children;
    }
    export function Text(props) {
      textos.push({ ...props, style: aplanar(props.style) }); return props.children;
    }
  `,
  '@react-native-vector-icons/ionicons': 'export function Ionicons() { return null; }',
  '@/shared/components': 'export function PinLoadingIndicator() { return null; }',
  '@/shared/components/PinLoadingIndicator': 'export function PinLoadingIndicator() { return null; }',
};
const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier in dobles) return { url: `prueba:${specifier}`, shortCircuit: true };
    if (specifier === '@/core/theme') return {
      url: new URL('../src/core/theme/index.ts', import.meta.url).href, shortCircuit: true,
    };
    if (specifier.startsWith('@/shared/components/mapa/')) return {
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
      format: 'module', shortCircuit: true, source: dobles[url.slice(7)],
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
const { ContextoTema } = await import('../src/core/theme/useTema.ts');
const { obtenerTema } = await import('../src/core/theme/tokens.ts');
const { useEstiloMapa } = await import('../src/features/booking/presentation/mapStyle.ts');
const { lineas, marcadores } = await import('react-native-maps');
const { vistas, textos } = await import('react-native');
hooks.deregister();

const origen = { latitude: -16.51, longitude: -68.15 };
const destino = { latitude: -16.50, longitude: -68.15 };
const ruta = [origen, destino];

test('mapa y trayecto siguen el tema elegido sin cambiar la visibilidad de lugares', () => {
  let estilo;
  function Mapa({ ocultar }) {
    estilo = useEstiloMapa(ocultar);
    return createElement(RoutePolyline, { coordinates: ruta });
  }
  for (const modo of ['light', 'dark']) {
    for (const ocultar of [true, false]) {
      lineas.length = 0;
      const tema = obtenerTema(modo);
      renderToStaticMarkup(createElement(ContextoTema.Provider, { value: tema }, createElement(Mapa, { ocultar })));
      assert.equal(estilo.modoMapa, modo);
      assert.equal(estilo.estiloMapa[0].stylers[0].color, tema.colors.mapaTierra);
      assert.deepEqual(lineas.map((linea) => linea.strokeColor), [tema.colors.surface, tema.colors.primary]);
      assert.equal(estilo.estiloMapa.some((regla) => regla.featureType === 'poi' && regla.elementType === 'labels'
        && regla.stylers.some((valor) => valor.visibility === 'off')), ocultar);
      for (const feature of ['landscape.man_made', 'landscape.natural.terrain', 'poi']) {
        assert.deepEqual(estilo.estiloMapa.find(rule => rule.featureType === feature
          && rule.elementType === 'geometry').stylers, [{ visibility: 'off' }]);
      }
      assert.deepEqual(estilo.estiloMapa.find(rule => rule.featureType === 'poi.park'
        && rule.elementType === 'geometry').stylers, [{ visibility: 'on' }, { color: tema.colors.mapaParque }]);
      assert.deepEqual(lineas.map((linea) => linea.strokeWidth), [5, 3]);
    }
  }
});

test('la ruta compartida dibuja un trazo fino de 3 y un contorno de 5', () => {
  lineas.length = 0;
  renderToStaticMarkup(createElement(RoutePolyline, { coordinates: ruta }));
  assert.equal(lineas.length, 2);
  assert.deepEqual(lineas.map((linea) => linea.strokeWidth), [5, 3]);
  assert.deepEqual(lineas.map((linea) => linea.zIndex), [1, 2]);
  assert.ok(lineas.every((linea) => linea.coordinates === ruta));
});

test('una ruta vacía o de un solo punto no deja trazos sueltos', () => {
  for (const coordinates of [[], [origen]]) {
    lineas.length = 0;
    renderToStaticMarkup(createElement(RoutePolyline, { coordinates }));
    assert.equal(lineas.length, 0);
  }
});

test('A y B mantienen tamaño y tipografía al editar, cargar u ocultar el tooltip', () => {
  for (const kind of ['A', 'B']) {
    for (const variante of [{}, { showEditControl: true }, { loading: true }, { showTooltip: false }]) {
      vistas.length = textos.length = marcadores.length = 0;
      renderToStaticMarkup(createElement(RoutePinMarker, {
        kind, coordinate: kind === 'A' ? origen : destino,
        label: 'Una dirección larga que ocupa más de una línea', ruta, ...variante,
      }));
      const letra = textos.find((texto) => texto.children === kind);
      const pin = vistas.find((vista) => vista.style.width === 16 && vista.style.height === 16);
      assert.ok(pin, 'El pin debe medir 16 en todas las variantes');
      assert.equal(pin.style.borderWidth, 1.5);
      assert.equal(pin.style.borderRadius, 8, 'Origen y destino conservan su forma circular');
      assert.equal(letra.style.fontSize, 9);
      assert.equal(letra.style.includeFontPadding, false);
      assert.equal(letra.allowFontScaling, false, 'La letra del símbolo conserva el anclaje del mapa');
      assert.equal(vistas[0].collapsable, false, 'Conserva el contenedor nativo completo');
      assert.equal(marcadores[0].coordinate, kind === 'A' ? origen : destino);
      if (variante.showTooltip !== false) {
        const tooltip = textos.find((texto) => texto.numberOfLines === 2);
        assert.equal(tooltip.style.fontSize, 10, 'La etiqueta no cambia de tamaño por pantalla');
      }
    }
  }
});

test('los pines conservan su forma y actualizan sus colores en ambos temas', () => {
  for (const modo of ['light', 'dark']) {
    const tema = obtenerTema(modo);
    for (const kind of ['A', 'B']) {
      vistas.length = textos.length = marcadores.length = 0;
      renderToStaticMarkup(createElement(ContextoTema.Provider, { value: tema },
        createElement(RoutePinMarker, { kind, coordinate: origen, label: 'Punto del viaje' })));
      const pin = vistas.find((vista) => vista.style.width === 16 && vista.style.height === 16);
      assert.equal(pin.style.backgroundColor, kind === 'A' ? tema.colors.primary : tema.colors.danger);
      assert.equal(pin.style.borderColor, tema.colors.surface);
      assert.equal(textos.find((texto) => texto.children === kind).style.color, tema.colors.textOnPrimary);
      assert.equal(marcadores[0].accessibilityLabel, 'Punto del viaje');
    }
  }
});

test('sin espacio para el tooltip conserva el pin, el título nativo y la acción de edición', () => {
  vistas.length = textos.length = marcadores.length = 0;
  const editar = () => {};
  renderToStaticMarkup(createElement(RoutePinMarker, {
    kind: 'A', coordinate: origen, label: 'Origen: Calle de prueba',
    ruta: [{ ...origen, latitude: -17 }, { ...origen, latitude: -16 }],
    zoomMapa: 15, showEditControl: true, onPress: editar,
  }));
  assert.equal(vistas[1].style.opacity, 0);
  assert.equal(marcadores[0].title, 'Origen: Calle de prueba');
  assert.equal(marcadores[0].onPress, editar);
  assert.ok(vistas.some((vista) => vista.style.width === 16 && vista.style.height === 16));
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
        assert.equal(attributes.get('customMapStyle')?.getText(source), '{estiloMapa}', file.pathname);
        assert.equal(attributes.get('userInterfaceStyle')?.getText(source), '{modoMapa}', file.pathname);
      }
      ts.forEachChild(node, visit);
    }
    visit(source);
  }
  assert.ok(count >= 7, 'All passenger and driver map screens are checked');
});
