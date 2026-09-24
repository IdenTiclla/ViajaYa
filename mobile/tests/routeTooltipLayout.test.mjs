import assert from 'node:assert/strict';
import test from 'node:test';

import {
  computePinAnchor,
  chooseTooltipPlacement,
  projectRouteRelativeToPin,
  ROUTE_PIN_SIZE,
  placeTooltipClearOfRoute,
} from '../src/features/rides/presentation/routeTooltipLayout.ts';

const sur = { latitude: -16.51, longitude: -68.15 };
const norte = { latitude: -16.50, longitude: -68.15 };

test('las etiquetas quedan fuera del trayecto vertical en ambos sentidos', () => {
  assert.equal(chooseTooltipPlacement('A', sur, [sur, norte]), 'below');
  assert.equal(chooseTooltipPlacement('B', norte, [sur, norte]), 'above');
  assert.equal(chooseTooltipPlacement('A', norte, [norte, sur]), 'above');
  assert.equal(chooseTooltipPlacement('B', sur, [norte, sur]), 'below');
});

test('el tramo cercano manda aunque la ruta dé un rodeo en sentido opuesto', () => {
  const rodeoSur = { ...sur, latitude: sur.latitude - 0.001 };
  const rodeoNorte = { ...norte, latitude: norte.latitude + 0.001 };
  const ruta = [sur, rodeoSur, rodeoNorte, norte];
  assert.equal(chooseTooltipPlacement('A', sur, ruta), 'above');
  assert.equal(chooseTooltipPlacement('B', norte, ruta), 'below');
});

test('girar el mapa invierte el lado libre de las etiquetas', () => {
  assert.equal(chooseTooltipPlacement('A', sur, [sur, norte], 180), 'above');
  assert.equal(chooseTooltipPlacement('B', norte, [sur, norte], 180), 'below');
  const este = { ...sur, longitude: sur.longitude + 0.01 };
  assert.equal(chooseTooltipPlacement('A', sur, [sur, este], 90), 'below');
  assert.equal(chooseTooltipPlacement('A', sur, [sur, este], 270), 'above');
});

test('puntos duplicados y ajustes mínimos de la calle no invierten la etiqueta', () => {
  const ajuste = { ...sur, latitude: sur.latitude - 0.000001 };
  assert.equal(chooseTooltipPlacement('A', sur, [sur, sur, ajuste, norte]), 'below');
});

test('un trayecto horizontal separa las etiquetas arriba y abajo', () => {
  const este = { ...sur, longitude: sur.longitude + 0.01 };
  assert.equal(chooseTooltipPlacement('A', sur, [sur, este]), 'above');
  assert.equal(chooseTooltipPlacement('B', este, [sur, este]), 'below');
});

test('sin trayecto o con puntos coincidentes conserva posiciones válidas', () => {
  assert.equal(chooseTooltipPlacement('A', sur, []), 'above');
  assert.equal(chooseTooltipPlacement('B', sur, [sur, sur]), 'below');
});

test('el centro del pin no se desplaza al crecer la etiqueta o mostrar Editar', () => {
  for (const altura of [ROUTE_PIN_SIZE, 44, 62, 92]) {
    const arriba = computePinAnchor(altura, 'above');
    const abajo = computePinAnchor(altura, 'below');
    // The center stays half a diameter from the edge, independent of the tooltip.
    assert.ok(Math.abs(altura - arriba.y * altura - ROUTE_PIN_SIZE / 2) < 0.000001);
    assert.ok(Math.abs(abajo.y * altura - ROUTE_PIN_SIZE / 2) < 0.000001);
    assert.equal(arriba.x, 0.5);
    assert.equal(abajo.x, 0.5);
  }
  assert.deepEqual(computePinAnchor(0, 'above'), { x: 0.5, y: 0.5 });
});

const medidas = { width: 140, height: 32 };
const ubicar = (ruta, preferida = 'above', etiqueta = medidas) =>
  placeTooltipClearOfRoute(ruta, etiqueta, preferida);

test('una curva que regresa por detrás del texto obliga a separarlo más del pin', () => {
  const resultado = ubicar([
    { x: 0, y: 0 }, { x: 0, y: 90 }, { x: 120, y: 90 },
    { x: 120, y: -30 }, { x: -120, y: -30 },
  ]);
  assert.equal(resultado.placement, 'above');
  assert.equal(resultado.visible, true);
  assert.ok(resultado.separation > 28, 'Debe superar la calle que cruza a 30 del pin');
});

test('detecta el cruce de un segmento aunque sus dos vértices estén fuera del tooltip', () => {
  const resultado = ubicar([{ x: -200, y: -30 }, { x: 200, y: -30 }]);
  assert.deepEqual(resultado, { placement: 'below', separation: 8, visible: true });
});

test('el tamaño real del bloque cuenta, incluyendo etiquetas largas y Editar', () => {
  const ruta = [{ x: 60, y: -30 }, { x: 100, y: -30 }];
  assert.equal(ubicar(ruta, 'above', { width: 40, height: 20 }).placement, 'above');
  assert.equal(ubicar(ruta, 'above', { width: 170, height: 70 }).placement, 'below');
  const horizontal = [{ x: -100, y: -65 }, { x: 100, y: -65 }];
  assert.equal(ubicar(horizontal, 'above', { width: 140, height: 20 }).placement, 'above');
  assert.equal(ubicar(horizontal, 'above', { width: 140, height: 70 }).placement, 'below');
});

test('la proyección usa la escala del zoom y el rumbo de la cámara', () => {
  const este = { ...sur, longitude: sur.longitude + 0.01 };
  const [cerca] = projectRouteRelativeToPin(sur, [este], 0, 15);
  const [lejos] = projectRouteRelativeToPin(sur, [este], 0, 14);
  const [girado] = projectRouteRelativeToPin(sur, [este], 90, 15);
  assert.ok(Math.abs(cerca.x - lejos.x * 2) < 0.000001);
  assert.ok(Math.abs(girado.x) < 0.000001);
  assert.ok(Math.abs(girado.y + cerca.x) < 0.000001);
  assert.equal(Math.abs(cerca.y), 0);
});

test('recalcula las colisiones al acercar y girar el mapa', () => {
  const ruta = [
    { latitude: sur.latitude + 0.001, longitude: sur.longitude - 0.01 },
    { latitude: sur.latitude + 0.001, longitude: sur.longitude + 0.01 },
  ];
  const normal = projectRouteRelativeToPin(sur, ruta, 0, 15);
  const cerca = projectRouteRelativeToPin(sur, ruta, 0, 18);
  const girada = projectRouteRelativeToPin(sur, ruta, 180, 15);
  assert.equal(ubicar(normal).placement, 'below');
  assert.equal(ubicar(cerca).placement, 'above');
  assert.equal(ubicar(girada, 'below').placement, 'above');
});

test('sin espacio libre no tapa la ruta ni genera un bitmap desmesurado', () => {
  const resultado = ubicar([{ x: 0, y: -10000 }, { x: 0, y: 10000 }]);
  assert.deepEqual(resultado, { placement: 'above', separation: 8, visible: false });
});

test('rutas vacías, duplicados y calles fuera de la etiqueta mantienen la posición', () => {
  for (const ruta of [[], [{ x: 0, y: 0 }, { x: 0, y: 0 }],
    [{ x: 100, y: -100 }, { x: 100, y: 100 }]]) {
    assert.deepEqual(ubicar(ruta), { placement: 'above', separation: 8, visible: true });
  }
});
