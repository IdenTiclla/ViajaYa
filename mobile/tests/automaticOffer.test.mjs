import assert from 'node:assert/strict';
import test from 'node:test';
import { registerHooks } from 'node:module';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

const state={};globalThis.__arrivalTest=state;
const mocks={
  '@tanstack/react-query':'export const useMutation=options=>options; export const useQueryClient=()=>({invalidateQueries:async()=>{}});',
  '@/features/booking/data/routesService':'export const fetchRoute=(...args)=>globalThis.__arrivalTest.route(...args);',
  '@/features/home/data/locationService':'export const locationService={getRoutingCoordinates:()=>globalThis.__arrivalTest.location()};',
  '@/features/rides/data/ridesRepository':'export const ridesRepository={createOffer:(...args)=>globalThis.__arrivalTest.send(...args)};',
  '@/store/authStore':'export const useAuthStore={getState:()=>({user:globalThis.__arrivalTest.user})};',
};
const hooks=registerHooks({
  resolve(specifier,context,nextResolve){
    if(specifier in mocks)return {url:`arrival-test:${specifier}`,shortCircuit:true};
    if(specifier==='@/features/rides/domain/offerArrivalTime')return nextResolve(new URL('../src/features/rides/domain/offerArrivalTime.ts',import.meta.url).href,context);
    return nextResolve(specifier,context);
  },
  load(url,context,nextLoad){
    if(url.startsWith('arrival-test:'))return {format:'module',shortCircuit:true,source:mocks[url.slice(13)]};
    if(url.endsWith('.ts'))return {format:'module',shortCircuit:true,source:ts.transpileModule(readFileSync(new URL(url),'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext},fileName:url}).outputText};
    return nextLoad(url,context);
  },
});
const {useAutomaticOffer}=await import('../src/features/driver/application/useAutomaticOffer.ts');hooks.deregister();
const origin={latitude:-16.50,longitude:-68.13},pickup={latitude:-16.51,longitude:-68.12};
const input={rideId:'ride',poolVersion:4,service:'taxi',pickup,input:{acceptAtFare:false,price:28}};
function reset(){
  state.user={id:'driver',vehicleType:'taxi'};state.calls=[];
  state.location=async()=>origin;state.route=async()=>({durationSeconds:301});
  state.send=async(...args)=>{state.calls.push(args);return {id:'offer'};};
}
for(const [service,vehicle,profile] of [['taxi','taxi','taxi'],['moto','moto','moto'],['delivery','moto','moto'],['delivery','taxi','taxi'],['moving','truck','taxi']]){
  test(`automatic pickup ETA uses actual vehicle for ${service}/${vehicle}`,async()=>{
    reset();state.user.vehicleType=vehicle;
    state.route=async(a,b,mode)=>{assert.deepEqual(a,origin);assert.deepEqual(b,pickup);assert.equal(mode,profile);return {durationSeconds:301};};
    await useAutomaticOffer().mutationFn({...input,service});
    assert.deepEqual(state.calls,[['ride',{acceptAtFare:false,price:28,etaMin:6,expectedPoolVersion:4}]]);
  });
}
for(const failure of ['gps','route','far','changed-user']){
  test(`no offer is sent when automatic arrival fails: ${failure}`,async()=>{
    reset();
    if(failure==='gps')state.location=async()=>{throw new Error('GPS unavailable');};
    if(failure==='route')state.route=async()=>null;
    if(failure==='far')state.route=async()=>({durationSeconds:15000});
    if(failure==='changed-user')state.route=async()=>{state.user={id:'another',vehicleType:'moto'};return {durationSeconds:120};};
    await assert.rejects(useAutomaticOffer().mutationFn(input));assert.deepEqual(state.calls,[]);
  });
}
