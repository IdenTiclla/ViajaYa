import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import test from 'node:test';
import ts from 'typescript';
import { AxiosError, CanceledError } from 'axios';

let queryOptions;
globalThis.__routeTestQuery = options => {queryOptions=options;return {};};
const driverState = { user: { id: 'driver', vehicleType: 'taxi' }, calls: [] };
globalThis.__routeTestDriver = driverState;
const mocks = {
  '@/store/authStore': 'export const useAuthStore={getState:()=>({user:globalThis.__routeTestDriver.user})};',
  '@/features/home/data/locationService': 'export const locationService={getRoutingCoordinates:async()=>({latitude:-16.5,longitude:-68.13})};',
  '@/features/rides/data/ridesRepository': 'export const ridesRepository={createOffer:async(...args)=>{globalThis.__routeTestDriver.calls.push(args);return {id:"offer"};}};',
};
const hooks=registerHooks({
  resolve(specifier,context,nextResolve){
    if(specifier in mocks)return {url:`route-mock:${specifier}`,shortCircuit:true};
    if(specifier==='@/features/rides/domain/offerArrivalTime')return nextResolve(new URL('../src/features/rides/domain/offerArrivalTime.ts',import.meta.url).href,context);
    if(specifier==='@/core/config/env')return {url:'route-test:env',shortCircuit:true};
    if(specifier==='@/core/http/client')return nextResolve(new URL('../src/core/http/client.ts',import.meta.url).href,context);
    if(specifier==='@/core/http/tokenStorage')return {url:'route-test:tokens',shortCircuit:true};
    if(specifier==='@tanstack/react-query')return {url:'route-test:query',shortCircuit:true};
    if(specifier==='@/features/booking/data/routesService')return nextResolve(new URL('../src/features/booking/data/routesService.ts',import.meta.url).href,context);
    if(specifier==='../domain/routeTravelMode')return nextResolve(new URL('../src/features/booking/domain/routeTravelMode.ts',import.meta.url).href,context);
    if(specifier==='../domain/optimalRoute')return nextResolve(new URL('../src/features/booking/domain/optimalRoute.ts',import.meta.url).href,context);
    return nextResolve(specifier,context);
  },
  load(url,context,nextLoad){
    if(url.startsWith('route-mock:'))return {format:'module',shortCircuit:true,source:mocks[url.slice('route-mock:'.length)]};
    if(url==='route-test:env')return {format:'module',shortCircuit:true,source:'export const env={googleMapsApiKey:"test-key",appEnv:"development",apiUrl:"https://api.test/api/v1"};'};
    if(url==='route-test:tokens')return {format:'module',shortCircuit:true,source:'export const tokenStorage={get:async()=>({accessToken:"private-viajaya-token"}),prepareRefresh:()=>{throw new Error("Must not refresh for Google");}};'};
    if(url==='route-test:query')return {format:'module',shortCircuit:true,source:'export const useQuery=options=>globalThis.__routeTestQuery(options); export const useMutation=options=>options; export const useQueryClient=()=>({invalidateQueries:async()=>{}});'};
    if(url.endsWith('.ts'))return {format:'module',shortCircuit:true,source:ts.transpileModule(readFileSync(new URL(url),'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext},fileName:url}).outputText};
    return nextLoad(url,context);
  },
});
const {fetchRoute}=await import('../src/features/booking/data/routesService.ts');
const {selectOptimalRoute}=await import('../src/features/booking/domain/optimalRoute.ts');
const {useRoute}=await import('../src/features/booking/application/useRoute.ts');
const {api}=await import('../src/core/http/client.ts');
const {env}=await import('@/core/config/env');
const {useAutomaticOffer}=await import('../src/features/driver/application/useAutomaticOffer.ts');
hooks.deregister();
const origin={latitude:-16.5,longitude:-68.13};
const destination={latitude:-16.49,longitude:-68.14};
test('Google receives the selected service profile and returns its geometry',async t=>{
  const original=api.defaults.adapter;t.after(()=>{api.defaults.adapter=original;});
  for(const [service,mode] of [['taxi','DRIVE'],['moto','TWO_WHEELER']]){
    api.defaults.adapter=async config=>{
      assert.equal(config.headers.get('Authorization'),undefined);
      assert.equal(config.headers.get('X-Goog-Api-Key'),'test-key');
      const payload=JSON.parse(config.data);
      assert.equal(payload.travelMode,mode);
      assert.equal(payload.routingPreference,'TRAFFIC_AWARE_OPTIMAL');
      assert.equal(payload.computeAlternativeRoutes,true);
      assert.equal(payload.polylineQuality,'HIGH_QUALITY');
      assert.deepEqual(payload.origin.location.latLng,origin);
      return {status:200,statusText:'OK',headers:{},config,data:{routes:[{polyline:{geoJsonLinestring:{coordinates:[[-68.13,-16.5],[-68.14,-16.49]]}},distanceMeters:2000,duration:'360s'}]}};
    };
    assert.deepEqual(await fetchRoute(origin,destination,service),{coordinates:[origin,destination],distanceMeters:2000,durationSeconds:360});
  }
});
test('a failed motorcycle route never silently requests a car route',async t=>{
  const original=api.defaults.adapter;t.after(()=>{api.defaults.adapter=original;});let calls=0;
  api.defaults.adapter=async config=>{calls++;throw new AxiosError('Unauthorized provider','ERR_BAD_REQUEST',config,null,{status:401,statusText:'Unauthorized',headers:{},config,data:{}});};
  await assert.rejects(fetchRoute(origin,destination,'moto'),/servicio de rutas no está disponible/);assert.equal(calls,1);
});
test('identical coordinates do not share taxi and motorcycle route cache entries',()=>{
  useRoute({coordinates:origin},{coordinates:destination},'taxi');const taxi=queryOptions.queryKey;
  useRoute({coordinates:origin},{coordinates:destination},'moto');assert.notDeepEqual(queryOptions.queryKey,taxi);
});

test('fastest valid route wins even when Google returns it after a slower or malformed alternative',()=>{
  const route=(duration,distanceMeters,points=[[-68.13,-16.5],[-68.14,-16.49]])=>({duration,distanceMeters,polyline:{geoJsonLinestring:{coordinates:points}}});
  const selected=selectOptimalRoute([
    route('600s',1000),route('invalid',1),route('2s',2,[[NaN,20],[22,23]]),
    route('360.5s',2100),route('360.5s',2000),route('400s',500),
  ]);
  assert.equal(selected.durationSeconds,360.5);
  assert.equal(selected.distanceMeters,2000);
  assert.equal(selectOptimalRoute([route('10s',100,[])]),null);
});

test('route refresh keeps same-endpoint geometry but never reuses another trip',()=>{
  const points={coordinates:[origin,destination]};
  useRoute({coordinates:origin},{coordinates:destination},'taxi');const taxi=queryOptions;
  useRoute({coordinates:origin},{coordinates:destination},'moving');assert.deepEqual(queryOptions.queryKey,taxi.queryKey);
  useRoute({coordinates:origin},{coordinates:destination},'moto');
  assert.equal(queryOptions.placeholderData(points,{queryKey:taxi.queryKey}),points);
  assert.equal(queryOptions.placeholderData(points,{queryKey:['route','DRIVE',0,0,0,0]}),undefined);
});

// Captured from Google computeRoutes for coincident and 4 m-apart waypoints:
// HTTP 200, duration 0s, one coordinate, distanceMeters omitted (default zero).
const stationaryProviderRoute = {
  duration: '0s', polyline: { geoJsonLinestring: { coordinates: [[-68.13, -16.5]] } },
};
for (const service of ['taxi', 'moto']) {
  for (const nearby of [false, true]) {
    test(`${service} publishes automatic arrival when pickup is ${nearby ? 'nearby' : 'coincident'}`, async t => {
      const original = api.defaults.adapter;
      t.after(() => { api.defaults.adapter = original; });
      driverState.calls = [];
      driverState.user.vehicleType = service;
      const pickup = nearby ? { latitude: -16.50004, longitude: -68.13 } : origin;
      api.defaults.adapter = async config => {
        assert.equal(JSON.parse(config.data).travelMode, service === 'moto' ? 'TWO_WHEELER' : 'DRIVE');
        assert.deepEqual(JSON.parse(config.data).destination.location.latLng, pickup);
        return { status: 200, statusText: 'OK', headers: {}, config, data: { routes: [stationaryProviderRoute] } };
      };
      await useAutomaticOffer().mutationFn({
        rideId: 'near-pickup', poolVersion: 7, service, pickup,
        input: { price: 25, acceptAtFare: false },
      });
      assert.deepEqual(driverState.calls, [['near-pickup', {
        price: 25, acceptAtFare: false, etaMin: 1, expectedPoolVersion: 7,
      }]]);
    });
  }
}

test('stationary route accepts omitted or explicit zero distance without inventing geometry', () => {
  for (const route of [stationaryProviderRoute, { ...stationaryProviderRoute, distanceMeters: 0 }]) {
    assert.deepEqual(selectOptimalRoute([route]), { coordinates: [origin], distanceMeters: 0, durationSeconds: 0 });
  }
});

test('stationary exception cannot admit incomplete or invalid moving routes', () => {
  for (const route of [
    { ...stationaryProviderRoute, duration: '12s' },
    { ...stationaryProviderRoute, distanceMeters: 20 },
    { ...stationaryProviderRoute, distanceMeters: null },
    { ...stationaryProviderRoute, duration: '-1s' },
    { ...stationaryProviderRoute, polyline: { geoJsonLinestring: { coordinates: [] } } },
    { ...stationaryProviderRoute, polyline: { geoJsonLinestring: { coordinates: [[-190, -16.5]] } } },
  ]) assert.equal(selectOptimalRoute([route]), null);
});

for (const status of [403, 429, 500, 503]) {
  test(`provider HTTP ${status} does not blame driver's connection or publish an offer`, async t => {
    const original = api.defaults.adapter;
    t.after(() => { api.defaults.adapter = original; });
    driverState.calls = [];
    api.defaults.adapter = async config => { throw new AxiosError('Provider failure', 'ERR_BAD_RESPONSE', config, null,
      { status, statusText: 'Error', headers: {}, config, data: {} }); };
    await assert.rejects(useAutomaticOffer().mutationFn({ rideId: 'trip', pickup: destination, service: 'taxi', input: {} }),
      { message: 'El servicio de rutas no está disponible en este momento. Intenta de nuevo en unos segundos.' });
    assert.deepEqual(driverState.calls, []);
  });
}

test('successful empty routes explain unavailable pickup routing instead of a connection problem', async t => {
  const original = api.defaults.adapter;
  t.after(() => { api.defaults.adapter = original; });
  driverState.calls = [];
  for (const data of [{}, { routes: [] }]) {
    api.defaults.adapter = async config => ({ status: 200, statusText: 'OK', headers: {}, config, data });
    assert.equal(await fetchRoute(origin, destination, 'taxi'), null);
    await assert.rejects(useAutomaticOffer().mutationFn({ rideId: 'trip', pickup: destination, service: 'taxi', input: {} }), /No encontramos una ruta/);
  }
  assert.deepEqual(driverState.calls, []);
});

test('malformed provider response stays distinct from unavailable routes', async t => {
  const original = api.defaults.adapter;
  t.after(() => { api.defaults.adapter = original; });
  for (const data of [null, { routes: 'invalid' }, { routes: [{ duration: '10s' }] }]) {
    api.defaults.adapter = async config => ({ status: 200, statusText: 'OK', headers: {}, config, data });
    await assert.rejects(fetchRoute(origin, destination, 'taxi'), /trayecto incompleto/);
  }
});

for (const [code, message] of [['ERR_NETWORK', /conectar con el servicio/], ['ECONNABORTED', /tardó demasiado/], ['ETIMEDOUT', /tardó demasiado/]]) {
  test(`route request reports ${code} accurately`, async t => {
    const original = api.defaults.adapter;
    t.after(() => { api.defaults.adapter = original; });
    api.defaults.adapter = async config => { throw new AxiosError('Failure', code, config); };
    await assert.rejects(fetchRoute(origin, destination, 'taxi'), message);
  });
}

test('aborted route request remains cancelled for query lifecycle', async t => {
  const original = api.defaults.adapter;
  t.after(() => { api.defaults.adapter = original; });
  const cancelled = new CanceledError();
  api.defaults.adapter = async () => { throw cancelled; };
  await assert.rejects(fetchRoute(origin, destination, 'taxi'), error => error === cancelled);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(fetchRoute(origin, destination, 'taxi', controller.signal), error => error.code === 'ERR_CANCELED');
});

test('missing routing configuration avoids network and connection blame', async t => {
  const key = env.googleMapsApiKey; const original = api.defaults.adapter;
  t.after(() => { env.googleMapsApiKey = key; api.defaults.adapter = original; });
  env.googleMapsApiKey = ''; api.defaults.adapter = async () => assert.fail('Must not request without provider key');
  await assert.rejects(fetchRoute(origin, destination, 'taxi'), /servicio de rutas no está disponible/);
});

test('map route failures finish promptly and retain explicit retry', () => {
  useRoute({ coordinates: origin }, { coordinates: destination }, 'taxi');
  assert.equal(queryOptions.retry, false);
});
