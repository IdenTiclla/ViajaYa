import assert from 'node:assert/strict';
import test from 'node:test';
import { registerHooks } from 'node:module';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
const state={};globalThis.__routingLocation=state;
const mocks={
  'expo-location':`export const Accuracy={Balanced:3};export const requestForegroundPermissionsAsync=async()=>({status:globalThis.__routingLocation.permission});export const hasServicesEnabledAsync=async()=>globalThis.__routingLocation.enabled;export const getCurrentPositionAsync=async()=>{globalThis.__routingLocation.calls++;return globalThis.__routingLocation.fix;};`,
  './observarUbicacion':'export const checkLocationAvailability=()=>{};export const watchLocation=()=>{};',
  '@/features/booking/domain/placeLabels':'export const isPlaceLabelResolved=()=>true;',
  '@/features/home/data/googleGeocodingService':'export const reverseGeocodeWithGoogle=()=>{};',
};
const hooks=registerHooks({
  resolve(specifier,context,nextResolve){if(specifier in mocks)return {url:`location-test:${specifier}`,shortCircuit:true};return nextResolve(specifier,context);},
  load(url,context,nextLoad){
    if(url.startsWith('location-test:'))return {format:'module',shortCircuit:true,source:mocks[url.slice(14)]};
    if(url.endsWith('.ts'))return {format:'module',shortCircuit:true,source:ts.transpileModule(readFileSync(new URL(url),'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext},fileName:url}).outputText};
    return nextLoad(url,context);
  },
});
const {locationService}=await import('../src/features/home/data/locationService.ts');hooks.deregister();
function reset(){state.permission='granted';state.enabled=true;state.calls=0;state.fix={timestamp:Date.now(),coords:{latitude:-16.5,longitude:-68.13,accuracy:20}};}
test('pickup routing uses a fresh current fix',async()=>{reset();assert.deepEqual(await locationService.getRoutingCoordinates(),{latitude:-16.5,longitude:-68.13});assert.equal(state.calls,1);});
for(const failure of ['denied','disabled','stale','inaccurate','missing-accuracy']){
 test(`pickup routing rejects ${failure} GPS without a guessed location`,async()=>{
  reset();if(failure==='denied')state.permission='denied';if(failure==='disabled')state.enabled=false;
  if(failure==='stale')state.fix.timestamp-=60000;if(failure==='inaccurate')state.fix.coords.accuracy=500;if(failure==='missing-accuracy')state.fix.coords.accuracy=null;
  await assert.rejects(locationService.getRoutingCoordinates());
 });
}
