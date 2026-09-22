import assert from 'node:assert/strict';
import test from 'node:test';
import { registerHooks } from 'node:module';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
const state = { store: {}, calls: [], nativeStarted: false, stored: null, worker: null, now: Date.now() };
globalThis.__driverGpsTest = state;
globalThis.__DEV__ = false;
const clock = Date.now; Date.now = () => state.now;
const mocks = {
  expo: 'export const requireOptionalNativeModule=()=>({});',
  'expo-location': `const s=globalThis.__driverGpsTest; export const Accuracy={High:4};
    export const getForegroundPermissionsAsync=async()=>s.existingPermission;
    export const requestForegroundPermissionsAsync=()=>s.permission();
    export const getLastKnownPositionAsync=()=>s.lastKnown();
    export const hasStartedLocationUpdatesAsync=async()=>s.nativeStarted;
    export const startLocationUpdatesAsync=async(name,options)=>{s.calls.push(['start',options]);s.nativeStarted=true;};
    export const stopLocationUpdatesAsync=async()=>{s.calls.push(['stop']);s.nativeStarted=false;};`,
  'expo-secure-store': `const s=globalThis.__driverGpsTest; export const getItemAsync=async()=>s.stored;
    export const setItemAsync=async(k,v)=>{s.stored=v;};export const deleteItemAsync=async()=>{s.stored=null;};`,
  'react-native': "export const Platform={OS:'android'};export const AppState={currentState:'active'};",
  '@/core/errors/apiError': 'export const getApiErrorStatus=e=>e?.status;',
  '../data/driverLocationRepository': 'export const driverLocationRepository={report:(...args)=>globalThis.__driverGpsTest.report(...args)};',
  './locationSharingStore': `export const useLocationSharingStore={getState:()=>globalThis.__driverGpsTest.store,
    setState:value=>Object.assign(globalThis.__driverGpsTest.store,value)};`,
};
state.taskManager = { isTaskDefined: () => true, defineTask: (name, worker) => { state.worker = worker; } };
const hooks = registerHooks({
  resolve(specifier, context, next) { if (specifier in mocks) return {url:'gps-test:'+specifier,shortCircuit:true};return next(specifier,context); },
  load(url, context, next) {
    if(url.startsWith('gps-test:'))return {format:'module',shortCircuit:true,source:mocks[url.slice(9)]};
    if(url.endsWith('/driverLocationTask.ts'))return {format:'module',shortCircuit:true,source:
      'const require=()=>globalThis.__driverGpsTest.taskManager;\n'+ts.transpileModule(readFileSync(new URL(url),'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext},fileName:url}).outputText};
    return next(url,context);
  },
});
const {startSharing,stopSharing}=await import('../src/features/tracking/application/driverLocationTask.ts'); hooks.deregister();
const context={rideId:'trip-a',userId:'driver-a'};
function sample(changes={}) { return {timestamp:state.now,coords:{latitude:-16.5,longitude:-68.13,accuracy:8,heading:90,...changes}}; }
async function reset(){await stopSharing();state.calls=[];state.now+=10_000;state.existingPermission={granted:false};state.permission=async()=>({granted:true});state.lastKnown=async()=>null;state.report=async(...args)=>{state.calls.push(['report',...args]);return {accepted:true};};}
test('foreground service continues sending while Waze is open and stops at trip end',async()=>{
  await reset();await startSharing(context);
  const options=state.calls.find(call=>call[0]==='start')[1];
  assert.equal(options.foregroundService.killServiceOnDestroy,true);assert.equal(options.timeInterval,5000);
  await state.worker({data:{locations:[sample()]}});
  assert.equal(state.store.status,'sharing');assert.equal(state.calls.filter(call=>call[0]==='report').length,1);
  state.now+=5_000;await state.worker({data:{locations:[sample({latitude:-16.51})]}});
  assert.equal(state.calls.filter(call=>call[0]==='report').length,2);
  await stopSharing();state.now+=5_000;await state.worker({data:{locations:[sample()]}});
  assert.equal(state.calls.filter(call=>call[0]==='report').length,2);assert.equal(state.stored,null);assert.equal(state.nativeStarted,false);
});
test('permission result after cancellation cannot restart a trip service',async()=>{
  await reset();let grant;state.permission=()=>new Promise(resolve=>{grant=resolve;});
  const starting=startSharing(context);await new Promise(setImmediate);
  const stopped=stopSharing();grant({granted:true});await Promise.all([starting,stopped]);
  assert.equal(state.nativeStarted,false);assert.equal(state.calls.length,0);assert.equal(state.stored,null);
});
test('inaccurate GPS is never uploaded, recovery resumes without losing the trip',async()=>{
  await reset();await startSharing(context);await state.worker({data:{locations:[sample({accuracy:150})]}});
  assert.equal(state.store.status,'error');assert.ok(!state.calls.some(call=>call[0]==='report'));
  state.now+=5_000;await state.worker({data:{locations:[sample()]}});assert.equal(state.store.status,'sharing');
});
test('transient upload failure retries the next sample; rejected trip stops sharing',async()=>{
  await reset();await startSharing(context);state.report=async()=>{throw {status:503};};
  await state.worker({data:{locations:[sample()]}});assert.equal(state.store.status,'error');assert.equal(state.nativeStarted,true);
  state.now+=5_000;state.report=async()=>{throw {status:409};};await state.worker({data:{locations:[sample()]}});
  await new Promise(setImmediate);assert.equal(state.nativeStarted,false);assert.equal(state.stored,null);
});
test('returning from Waze keeps the same healthy GPS service',async()=>{
  await reset();await startSharing(context);await state.worker({data:{locations:[sample()]}});await startSharing({...context});
  assert.equal(state.calls.filter(call=>call[0]==='start').length,1);
});
test('resuming from the permission dialog does not replace a pending start',async()=>{
  await reset();let grant;let requests=0;
  state.permission=()=>{requests+=1;return new Promise(resolve=>{grant=resolve;});};
  const first=startSharing(context);await new Promise(setImmediate);
  const resumed=startSharing({...context});grant({granted:true});await Promise.all([first,resumed]);
  assert.equal(requests,1);assert.equal(state.calls.filter(call=>call[0]==='start').length,1);
  await state.worker({data:{locations:[sample()]}});assert.equal(state.store.status,'sharing');
});
test('an existing location permission starts sharing without reopening the Android dialog',async()=>{
  await reset();state.existingPermission={granted:true};state.permission=()=>assert.fail('Permission already granted');
  await startSharing(context);await state.worker({data:{locations:[sample()]}});
  assert.equal(state.store.status,'sharing');
});
test('a recent fix is shared immediately without waiting for a background task',async()=>{
  await reset();state.lastKnown=async()=>sample({heading:-1});await startSharing(context);await new Promise(setImmediate);
  assert.equal(state.store.status,'sharing');const reports=state.calls.filter(call=>call[0]==='report');
  assert.equal(reports.length,1);assert.equal(reports[0][2].heading,null);
});
test('a cached fix resolving after trip end cannot resume publication',async()=>{
  await reset();let resolve;state.lastKnown=()=>new Promise(done=>{resolve=done;});
  await startSharing(context);await stopSharing();resolve(sample());await new Promise(setImmediate);
  assert.ok(!state.calls.some(call=>call[0]==='report'));assert.equal(state.store.status,'off');
});
test('an expired cached fix is not presented as live GPS',async()=>{
  await reset();state.lastKnown=async()=>({...sample(),timestamp:state.now-70_000});await startSharing(context);await new Promise(setImmediate);
  assert.ok(!state.calls.some(call=>call[0]==='report'));
});
test.after(async()=>{await stopSharing();Date.now=clock;});
