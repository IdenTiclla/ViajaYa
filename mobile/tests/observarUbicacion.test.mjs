import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import test from 'node:test';

const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === 'expo-location') return { url: 'prueba:ubicacion', shortCircuit: true };
    if (specifier === '../domain/orientacionUbicacion') return {
      url: new URL('../src/features/home/domain/orientacionUbicacion.ts', import.meta.url).href,
      shortCircuit: true,
    };
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url !== 'prueba:ubicacion') return nextLoad(url, context);
    return { format: 'module', shortCircuit: true, source: `
      export const PermissionStatus = { GRANTED: 'granted' }, Accuracy = { High: 4, Balanced: 3 };
      export const estado = {};
      export function reiniciar() {
        Object.assign(estado, { permiso: 'granted', tardio: false, sinBrujula: false,
          servicios: true, pedirPermiso: 0, permisoPendiente: null, inicial: null, consultasIniciales: 0,
          canAskAgain: true, altas: 0, bajasGps: 0, bajasBrujula: 0, pendientes: [], gps: null, brujula: null });
      }
      export async function getForegroundPermissionsAsync() {
        return estado.permisoPendiente ?? { status: estado.permiso, canAskAgain: estado.canAskAgain };
      }
      export async function requestForegroundPermissionsAsync() { estado.pedirPermiso++; return { status: estado.permiso }; }
      export async function hasServicesEnabledAsync() { return estado.servicios; }
      export function getCurrentPositionAsync(opciones) {
        estado.consultasIniciales++; estado.opcionesIniciales = opciones;
        return estado.inicial ?? Promise.reject(new Error('Sin posición inicial'));
      }
      export function watchPositionAsync(opciones, callback, error) {
        estado.altas++; estado.opciones = opciones; estado.gps = callback; estado.errorGps = error;
        const sub = { remove() { estado.bajasGps++; } };
        return estado.tardio ? new Promise(resolve => estado.pendientes.push(() => resolve(sub))) : Promise.resolve(sub);
      }
      export function watchHeadingAsync(callback, error) {
        estado.altas++; estado.brujula = callback; estado.errorBrujula = error;
        if (estado.sinBrujula) return Promise.reject(new Error('Sin sensor'));
        const sub = { remove() { estado.bajasBrujula++; } };
        return estado.tardio ? new Promise(resolve => estado.pendientes.push(() => resolve(sub))) : Promise.resolve(sub);
      }
    ` };
  },
});
const { observarUbicacion, consultarDisponibilidadUbicacion } = await import('../src/features/home/data/observarUbicacion.ts');
const { estado, reiniciar } = await import('expo-location');
hooks.deregister();

function lectura(timestamp, cambios = {}) {
  return { timestamp, coords: {
    latitude: -16.5, longitude: -68.15, heading: 0, speed: 0, accuracy: 3, ...cambios,
  } };
}

test('actualiza posición y orientación de forma independiente y prioriza el rumbo al avanzar', async (t) => {
  reiniciar();
  let ahora = 10000;
  t.mock.method(Date, 'now', () => ahora);
  const eventos = [];
  const sub = await observarUbicacion((coordinates, rumbo) => eventos.push({ coordinates, rumbo }));
  estado.brujula({ trueHeading: 30, magHeading: 20, accuracy: 3 });
  assert.equal(eventos.length, 0, 'La brújula no inventa una posición');
  estado.gps(lectura(ahora));
  assert.equal(eventos.at(-1).rumbo, 30);
  const coordenadas = eventos.at(-1).coordinates;
  ahora += 200;
  estado.brujula({ trueHeading: 90, magHeading: 80, accuracy: 3 });
  assert.equal(eventos.at(-1).rumbo, 90);
  assert.equal(eventos.at(-1).coordinates, coordenadas, 'Girar el teléfono no desplaza la cámara');
  ahora += 1000;
  estado.gps(lectura(ahora, { latitude: -16.4999, heading: 0, speed: 10 }));
  assert.equal(eventos.at(-1).rumbo, 0);
  assert.equal(eventos.at(-1).coordinates.latitude, -16.4999);
  ahora += 200;
  estado.brujula({ trueHeading: 180, magHeading: 170, accuracy: 3 });
  assert.equal(eventos.at(-1).rumbo, 0, 'Mover el teléfono no reemplaza el rumbo de conducción');
  ahora += 1000;
  estado.gps(lectura(ahora, { latitude: -16.4999 }));
  assert.equal(eventos.at(-1).rumbo, 180, 'Al detenerse vuelve a responder a la brújula');
  const cantidad = eventos.length;
  estado.gps(lectura(ahora - 5000, { longitude: -70 }));
  assert.equal(eventos.length, cantidad, 'Ignora un GPS atrasado');
  sub.remove();
  assert.equal(estado.bajasGps, 1);
  assert.equal(estado.bajasBrujula, 1);
});

test('el primer rumbo válido aparece aunque llegue inmediatamente después del GPS', async (t) => {
  reiniciar();
  t.mock.method(Date, 'now', () => 10000);
  const rumbos = [];
  const sub = await observarUbicacion((_, rumbo) => rumbos.push(rumbo));
  estado.gps(lectura(10000));
  estado.brujula({ trueHeading: 270, magHeading: 260, accuracy: 3 });
  assert.deepEqual(rumbos, [null, 270]);
  sub.remove();
});

test('cancelar antes del alta nativa retira ambos sensores y descarta sus callbacks tardíos', async () => {
  reiniciar(); estado.tardio = true;
  const sub = await observarUbicacion(() => assert.fail('Callback de una suscripción cancelada'));
  sub.remove(); sub.remove();
  estado.pendientes.forEach(resolve => resolve());
  await Promise.resolve();
  estado.gps(lectura(Date.now()));
  estado.brujula({ trueHeading: 90, magHeading: 80, accuracy: 3 });
  assert.equal(estado.bajasGps, 1);
  assert.equal(estado.bajasBrujula, 1);
});

test('sin brújula sigue recibiendo GPS y un error de ubicación cancela ambos sensores', async () => {
  reiniciar(); estado.sinBrujula = true;
  const eventos = []; let errores = 0;
  const sub = await observarUbicacion((coordinates) => eventos.push(coordinates), () => errores++);
  await Promise.resolve();
  estado.gps(lectura(Date.now(), { heading: 90, speed: 10 }));
  assert.equal(eventos.length, 1);
  estado.errorGps('GPS apagado');
  estado.gps(lectura(Date.now() + 1000));
  assert.equal(eventos.length, 1);
  assert.equal(errores, 1);
  assert.equal(estado.bajasGps, 1);
  sub.remove();
});

test('un permiso denegado no inicia ninguno de los sensores', async () => {
  reiniciar(); estado.permiso = 'denied';
  assert.equal(await observarUbicacion(() => assert.fail()), null);
  assert.equal(estado.altas, 0);
});

test('obtiene una primera posición sin esperar al watcher y no vuelve a consultar por cada lectura', async () => {
  reiniciar();
  estado.inicial = Promise.resolve(lectura(Date.now(), { latitude: -17.39, longitude: -66.16 }));
  const eventos = [];
  const sub = await observarUbicacion((coordinates) => eventos.push(coordinates));
  await Promise.resolve();
  assert.deepEqual(eventos[0], { latitude: -17.39, longitude: -66.16 });
  assert.equal(estado.pedirPermiso, 0, 'Un permiso concedido no abre otro diálogo');
  assert.equal(estado.opciones.mayShowUserSettingsDialog, false);
  assert.equal(estado.opcionesIniciales.accuracy, 3, 'El arranque también puede usar la red');
  for (let i = 1; i <= 10; i++) estado.gps(lectura(Date.now() + i));
  assert.equal(estado.consultasIniciales, 1, 'No hay polling ni altas por cada render');
  assert.equal(estado.altas, 2, 'Un GPS y una brújula');
  sub.remove();
});

test('descarta la ubicación inicial antigua y no desplaza un GPS más reciente', async () => {
  reiniciar();
  let resolver;
  estado.inicial = new Promise(resolve => { resolver = resolve; });
  const eventos = [];
  const sub = await observarUbicacion((coordinates) => eventos.push(coordinates));
  estado.gps(lectura(Date.now() - 60_000));
  assert.equal(eventos.length, 0, 'Una ubicación vieja no decide dónde abrir el mapa');
  estado.gps(lectura(Date.now(), { latitude: -17.39 }));
  resolver(lectura(Date.now() - 1000, { latitude: -16.5 }));
  await Promise.resolve();
  assert.equal(eventos.length, 1);
  assert.equal(eventos[0].latitude, -17.39);
  sub.remove();
});

test('cancelar durante el permiso impide activar sensores después de abandonar la pantalla', async () => {
  reiniciar();
  let resolver;
  estado.permisoPendiente = new Promise(resolve => { resolver = resolve; });
  const cancelacion = new AbortController();
  const inicio = observarUbicacion(() => assert.fail(), undefined, cancelacion.signal);
  cancelacion.abort();
  resolver({ status: 'granted', canAskAgain: true });
  assert.equal(await inicio, null);
  assert.equal(estado.altas, 0);
  assert.equal(estado.consultasIniciales, 0);
});

test('la ubicación apagada se diferencia de un permiso denegado sin lanzar diálogos nativos', async () => {
  reiniciar(); estado.servicios = false;
  const errores = [];
  assert.equal(await observarUbicacion(() => assert.fail(), motivo => errores.push(motivo)), null);
  assert.deepEqual(errores, ['disabled']);
  assert.equal(await consultarDisponibilidadUbicacion(), 'disabled');
  assert.equal(estado.altas, 0);
  assert.equal(estado.pedirPermiso, 0);
  estado.servicios = true;
  assert.equal(await consultarDisponibilidadUbicacion(), 'granted');
  estado.permiso = 'denied';
  assert.equal(await consultarDisponibilidadUbicacion(), 'denied');
  assert.equal(estado.pedirPermiso, 0);
});

test('un reintento comparte la adquisición inicial pendiente y descarta al consumidor cancelado', async () => {
  reiniciar();
  let resolver;
  estado.inicial = new Promise(resolve => { resolver = resolve; });
  const anterior = await observarUbicacion(() => assert.fail('Consumidor cancelado'));
  anterior.remove();
  const eventos = [];
  const actual = await observarUbicacion((coordinates) => eventos.push(coordinates));
  assert.equal(estado.consultasIniciales, 1);
  resolver(lectura(Date.now()));
  await Promise.resolve();
  assert.equal(eventos.length, 1);
  actual.remove();
});
