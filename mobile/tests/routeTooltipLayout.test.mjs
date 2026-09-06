import assert from 'node:assert/strict';
import test from 'node:test';

import {
  calcularAnclajePin,
  elegirPosicionTooltip,
  proyectarRutaRespectoAlPin,
  TAMANO_PIN_RUTA,
  ubicarTooltipSinCruzarRuta,
} from '../src/features/rides/presentation/routeTooltipLayout.ts';

const sur = { latitude: -16.51, longitude: -68.15 };
const norte = { latitude: -16.50, longitude: -68.15 };

test('las etiquetas quedan fuera del trayecto vertical en ambos sentidos', () => {
  assert.equal(elegirPosicionTooltip('A', sur, [sur, norte]), 'abajo');
  assert.equal(elegirPosicionTooltip('B', norte, [sur, norte]), 'arriba');
  assert.equal(elegirPosicionTooltip('A', norte, [norte, sur]), 'arriba');
  assert.equal(elegirPosicionTooltip('B', sur, [norte, sur]), 'abajo');
});

test('el tramo cercano manda aunque la ruta dé un rodeo en sentido opuesto', () => {
  const rodeoSur = { ...sur, latitude: sur.latitude - 0.001 };
  const rodeoNorte = { ...norte, latitude: norte.latitude + 0.001 };
  const ruta = [sur, rodeoSur, rodeoNorte, norte];
  assert.equal(elegirPosicionTooltip('A', sur, ruta), 'arriba');
  assert.equal(elegirPosicionTooltip('B', norte, ruta), 'abajo');
});

test('girar el mapa invierte el lado libre de las etiquetas', () => {
  assert.equal(elegirPosicionTooltip('A', sur, [sur, norte], 180), 'arriba');
  assert.equal(elegirPosicionTooltip('B', norte, [sur, norte], 180), 'abajo');
  const este = { ...sur, longitude: sur.longitude + 0.01 };
  assert.equal(elegirPosicionTooltip('A', sur, [sur, este], 90), 'abajo');
  assert.equal(elegirPosicionTooltip('A', sur, [sur, este], 270), 'arriba');
});

test('puntos duplicados y ajustes mínimos de la calle no invierten la etiqueta', () => {
  const ajuste = { ...sur, latitude: sur.latitude - 0.000001 };
  assert.equal(elegirPosicionTooltip('A', sur, [sur, sur, ajuste, norte]), 'abajo');
});

test('un trayecto horizontal separa las etiquetas arriba y abajo', () => {
  const este = { ...sur, longitude: sur.longitude + 0.01 };
  assert.equal(elegirPosicionTooltip('A', sur, [sur, este]), 'arriba');
  assert.equal(elegirPosicionTooltip('B', este, [sur, este]), 'abajo');
});

test('sin trayecto o con puntos coincidentes conserva posiciones válidas', () => {
  assert.equal(elegirPosicionTooltip('A', sur, []), 'arriba');
  assert.equal(elegirPosicionTooltip('B', sur, [sur, sur]), 'abajo');
});

test('el centro del pin no se desplaza al crecer la etiqueta o mostrar Editar', () => {
  for (const altura of [TAMANO_PIN_RUTA, 44, 62, 92]) {
    const arriba = calcularAnclajePin(altura, 'arriba');
    const abajo = calcularAnclajePin(altura, 'abajo');
    // El centro queda a medio diámetro del borde, sin depender del tooltip.
    assert.ok(Math.abs(altura - arriba.y * altura - TAMANO_PIN_RUTA / 2) < 0.000001);
    assert.ok(Math.abs(abajo.y * altura - TAMANO_PIN_RUTA / 2) < 0.000001);
    assert.equal(arriba.x, 0.5);
    assert.equal(abajo.x, 0.5);
  }
  assert.deepEqual(calcularAnclajePin(0, 'arriba'), { x: 0.5, y: 0.5 });
});

const medidas = { ancho: 140, alto: 32 };
const ubicar = (ruta, preferida = 'arriba', etiqueta = medidas) =>
  ubicarTooltipSinCruzarRuta(ruta, etiqueta, preferida);

test('una curva que regresa por detrás del texto obliga a separarlo más del pin', () => {
  const resultado = ubicar([
    { x: 0, y: 0 }, { x: 0, y: 90 }, { x: 120, y: 90 },
    { x: 120, y: -30 }, { x: -120, y: -30 },
  ]);
  assert.equal(resultado.posicion, 'arriba');
  assert.equal(resultado.visible, true);
  assert.ok(resultado.separacion > 28, 'Debe superar la calle que cruza a 30 del pin');
});

test('detecta el cruce de un segmento aunque sus dos vértices estén fuera del tooltip', () => {
  const resultado = ubicar([{ x: -200, y: -30 }, { x: 200, y: -30 }]);
  assert.deepEqual(resultado, { posicion: 'abajo', separacion: 8, visible: true });
});

test('el tamaño real del bloque cuenta, incluyendo etiquetas largas y Editar', () => {
  const ruta = [{ x: 60, y: -30 }, { x: 100, y: -30 }];
  assert.equal(ubicar(ruta, 'arriba', { ancho: 40, alto: 20 }).posicion, 'arriba');
  assert.equal(ubicar(ruta, 'arriba', { ancho: 170, alto: 70 }).posicion, 'abajo');
  const horizontal = [{ x: -100, y: -65 }, { x: 100, y: -65 }];
  assert.equal(ubicar(horizontal, 'arriba', { ancho: 140, alto: 20 }).posicion, 'arriba');
  assert.equal(ubicar(horizontal, 'arriba', { ancho: 140, alto: 70 }).posicion, 'abajo');
});

test('la proyección usa la escala del zoom y el rumbo de la cámara', () => {
  const este = { ...sur, longitude: sur.longitude + 0.01 };
  const [cerca] = proyectarRutaRespectoAlPin(sur, [este], 0, 15);
  const [lejos] = proyectarRutaRespectoAlPin(sur, [este], 0, 14);
  const [girado] = proyectarRutaRespectoAlPin(sur, [este], 90, 15);
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
  const normal = proyectarRutaRespectoAlPin(sur, ruta, 0, 15);
  const cerca = proyectarRutaRespectoAlPin(sur, ruta, 0, 18);
  const girada = proyectarRutaRespectoAlPin(sur, ruta, 180, 15);
  assert.equal(ubicar(normal).posicion, 'abajo');
  assert.equal(ubicar(cerca).posicion, 'arriba');
  assert.equal(ubicar(girada, 'abajo').posicion, 'arriba');
});

test('sin espacio libre no tapa la ruta ni genera un bitmap desmesurado', () => {
  const resultado = ubicar([{ x: 0, y: -10000 }, { x: 0, y: 10000 }]);
  assert.deepEqual(resultado, { posicion: 'arriba', separacion: 8, visible: false });
});

test('rutas vacías, duplicados y calles fuera de la etiqueta mantienen la posición', () => {
  for (const ruta of [[], [{ x: 0, y: 0 }, { x: 0, y: 0 }],
    [{ x: 100, y: -100 }, { x: 100, y: 100 }]]) {
    assert.deepEqual(ubicar(ruta), { posicion: 'arriba', separacion: 8, visible: true });
  }
});
