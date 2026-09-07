import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ts from 'typescript';

// Se renderizan los componentes productivos; solo se sustituyen las vistas
// nativas. Estas pruebas comprueban sus props, no el bitmap real de Android.
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
  '@expo/vector-icons': 'export function Ionicons() { return null; }',
  '@/shared/components': 'export function PinLoadingIndicator() { return null; }',
};
const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier in dobles) return { url: `prueba:${specifier}`, shortCircuit: true };
    if (specifier === '@/core/theme') return {
      url: new URL('../src/core/theme/index.ts', import.meta.url).href, shortCircuit: true,
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
      assert.equal(estilo.estiloMapa.some((regla) => regla.stylers.some((valor) => valor.visibility === 'off')), ocultar);
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

test('A y B mantienen el mismo diámetro y tipografía al editar, cargar u ocultar el tooltip', () => {
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
      assert.equal(letra.style.fontSize, 9);
      assert.equal(letra.style.includeFontPadding, false);
      assert.equal(vistas[0].collapsable, false, 'Conserva el contenedor nativo completo');
      assert.equal(marcadores[0].coordinate, kind === 'A' ? origen : destino);
      if (variante.showTooltip !== false) {
        const tooltip = textos.find((texto) => texto.numberOfLines === 2);
        assert.equal(tooltip.style.fontSize, 10, 'La etiqueta no cambia de tamaño por pantalla');
      }
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
