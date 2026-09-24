import assert from 'node:assert/strict';
import test from 'node:test';

import {
  getLabelAwareFitCoordinates,
  latitudeFromMercatorY,
  longitudeDelta,
  mercatorY,
  proyectarRutaRespectoAlPin,
  TAMANO_PIN_RUTA,
  ubicarTooltipSinCruzarRuta,
  elegirPosicionTooltip,
} from '../src/features/rides/presentation/routeTooltipLayout.ts';

// Emulates fitToCoordinates on a north-up map: the bounding box fills the padded viewport.
function projectFit(points, width, height, padding) {
  const ref = points[0].longitude;
  const xs = points.map((p) => longitudeDelta(ref, p.longitude) / 360);
  const ys = points.map((p) => mercatorY(p.latitude));
  const [minX, maxX, minY, maxY] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const innerW = width - padding.left - padding.right;
  const innerH = height - padding.top - padding.bottom;
  const scale = Math.min(innerW / (maxX - minX || Infinity), innerH / (maxY - minY || Infinity));
  const cx = padding.left + innerW / 2;
  const cy = padding.top + innerH / 2;
  return {
    scale,
    zoom: Math.log2(scale / 256),
    toScreen: (p) => ({
      x: cx + (longitudeDelta(ref, p.longitude) / 360 - (minX + maxX) / 2) * scale,
      y: cy - (mercatorY(p.latitude) - (minY + maxY) / 2) * scale,
    }),
  };
}

// Where RoutePinMarker really draws the label at the fitted zoom.
function labelRect(label, route, fit) {
  const preferred = elegirPosicionTooltip(label.kind, label.coordinate, route);
  const placed = ubicarTooltipSinCruzarRuta(
    proyectarRutaRespectoAlPin(label.coordinate, route, 0, fit.zoom), label.size, preferred,
  );
  if (!placed.visible) return null;
  const pin = fit.toScreen(label.coordinate);
  const near = TAMANO_PIN_RUTA / 2 + placed.separacion;
  const [top, bottom] = placed.posicion === 'arriba'
    ? [pin.y - near - label.size.alto, pin.y - near]
    : [pin.y + near, pin.y + near + label.size.alto];
  return { left: pin.x - label.size.ancho / 2, right: pin.x + label.size.ancho / 2, top, bottom };
}

const A = { latitude: -17.3935, longitude: -66.1570 };
const routes = {
  'short horizontal trip': [A, { latitude: -17.3937, longitude: -66.1540 }],
  'short vertical trip': [{ latitude: -17.3900, longitude: -66.1570 }, { latitude: -17.3930, longitude: -66.1571 }],
  'long diagonal trip': [{ latitude: -17.36, longitude: -66.20 }, { latitude: -17.42, longitude: -66.12 }],
  // Leaves A eastwards and loops back over it: the marker moves A's label to the other side.
  'route looping back past the origin': [
    A, { latitude: -17.3935, longitude: -66.1555 }, { latitude: -17.3931, longitude: -66.1555 },
    { latitude: -17.3940, longitude: -66.1560 }, { latitude: -17.3940, longitude: -66.1580 },
    { latitude: -17.3900, longitude: -66.1560 },
  ],
};
test('the looping route really makes the marker move the origin label', () => {
  const route = routes['route looping back past the origin'];
  const placed = ubicarTooltipSinCruzarRuta(
    proyectarRutaRespectoAlPin(A, route, 0, 16.5), { ancho: 178, alto: 40 },
    elegirPosicionTooltip('A', A, route),
  );
  assert.equal(elegirPosicionTooltip('A', A, route), 'arriba');
  assert.equal(placed.posicion, 'abajo');
  assert.ok(placed.separacion > 8);
});

const sizes = { 'default font': { ancho: 178, alto: 40 }, '200% font': { ancho: 178, alto: 72 } };
const [width, height] = [390, 360];
const padding = { top: 88, bottom: 16, left: 16, right: 16 };

for (const [routeName, route] of Object.entries(routes)) {
  for (const [sizeName, size] of Object.entries(sizes)) {
    test(`A/B labels stay inside the viewport: ${routeName}, ${sizeName}`, () => {
      const labels = [
        { kind: 'A', coordinate: route[0], size },
        { kind: 'B', coordinate: route.at(-1), size },
      ];
      const fit = projectFit(getLabelAwareFitCoordinates(route, labels, width, height, padding),
        width, height, padding);
      for (const label of labels) {
        const rect = labelRect(label, route, fit);
        if (!rect) continue;
        assert.ok(rect.left >= padding.left - 1, `${label.kind} left ${rect.left}`);
        assert.ok(rect.right <= width - padding.right + 1, `${label.kind} right ${rect.right}`);
        assert.ok(rect.top >= padding.top - 1, `${label.kind} top ${rect.top} under the header`);
        assert.ok(rect.bottom <= height - padding.bottom + 1, `${label.kind} bottom ${rect.bottom}`);
      }
    });
  }
}

test('label-aware framing zooms closer than a uniform tooltip margin', () => {
  const route = routes['short horizontal trip'];
  const size = sizes['default font'];
  const labels = [{ kind: 'A', coordinate: route[0], size }, { kind: 'B', coordinate: route[1], size }];
  const smart = projectFit(getLabelAwareFitCoordinates(route, labels, width, height, padding),
    width, height, padding);
  const uniform = { top: padding.top + 64, bottom: padding.bottom + 64, left: 16 + 89, right: 16 + 89 };
  assert.ok(smart.scale >= projectFit(route, width, height, uniform).scale);
});

test('degenerate input is returned untouched', () => {
  const size = sizes['default font'];
  const labels = [{ kind: 'A', coordinate: A, size }];
  const none = { top: 0, bottom: 0, left: 0, right: 0 };
  assert.deepEqual(getLabelAwareFitCoordinates([A, A], labels, width, height, none), [A, A]);
  assert.deepEqual(getLabelAwareFitCoordinates([A], labels, width, height, none), [A]);
  assert.deepEqual(getLabelAwareFitCoordinates(routes['long diagonal trip'], [], width, height, none),
    routes['long diagonal trip']);
});

test('the shared Mercator helpers round-trip and wrap the antimeridian', () => {
  for (const latitude of [-60, -17.39, 0, 45.5]) {
    assert.ok(Math.abs(latitudeFromMercatorY(mercatorY(latitude)) - latitude) < 1e-9);
  }
  assert.equal(longitudeDelta(179, -179), 2);
  assert.equal(longitudeDelta(-179, 179), -2);
});
