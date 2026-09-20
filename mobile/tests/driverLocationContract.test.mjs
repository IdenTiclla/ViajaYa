import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {registerHooks} from 'node:module';
import ts from 'typescript';
const state={};globalThis.__gpsContract=state;
const hooks=registerHooks({
 resolve(name,context,next){if(name==='@/core/http/client')return {url:'gps-contract:http',shortCircuit:true};return next(name,context);},
 load(url,context,next){
  if(url==='gps-contract:http')return {format:'module',shortCircuit:true,source:'export const api={get:(...args)=>globalThis.__gpsContract.get(...args),put:(...args)=>globalThis.__gpsContract.put(...args)};'};
  if(url.endsWith('.ts'))return {format:'module',shortCircuit:true,source:ts.transpileModule(readFileSync(new URL(url),'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext},fileName:url}).outputText};
  return next(url,context);
 }
});
const {driverLocationMessageSchema,driverLocationRepository}=await import('../src/features/tracking/data/driverLocationRepository.ts');hooks.deregister();
const contract=JSON.parse(readFileSync(new URL('../../backend/driver_location_contract.json',import.meta.url),'utf8'));
for(const frame of contract.examples)test(`backend GPS contract: ${frame.data?'position':'empty snapshot'}`,()=>{assert.ok(driverLocationMessageSchema.safeParse(frame).success);});
test('GPS DTO parser rejects invalid coordinates and identities',()=>{
 const frame=contract.examples[1];for(const data of [{...frame.data,latitude:91},{...frame.data,accuracy_meters:101},{...frame.data,ride_id:'other'},{...frame.data,captured_at:'yesterday'}])assert.equal(driverLocationMessageSchema.safeParse({...frame,data}).success,false);
});
test('repository preserves cancellation and translates snake_case for the map',async()=>{
 const frame=contract.examples[1];const abort=new AbortController();
 state.get=async(path,options)=>{assert.equal(path,`/rides/${frame.data.ride_id}/driver-location`);assert.equal(options.signal,abort.signal);return {data:frame.data};};
 const location=await driverLocationRepository.get(frame.data.ride_id,abort.signal);assert.equal(location.driverId,frame.data.driver_id);assert.equal(location.capturedAt,frame.data.captured_at);
 state.put=async(path,body,options)=>{assert.equal(options.signal,abort.signal);assert.equal(body,frame.data);};await driverLocationRepository.report(frame.data.ride_id,frame.data,abort.signal);
});
