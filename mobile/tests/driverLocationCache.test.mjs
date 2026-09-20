import assert from 'node:assert/strict';
import test from 'node:test';
import {registerHooks} from 'node:module';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
const state={cleanups:[]};globalThis.__gpsCache=state;
const mocks={
 react:`export const useState=init=>[typeof init==='function'?init():init,()=>{}];export const useEffect=fn=>{const cleanup=fn();if(cleanup)globalThis.__gpsCache.cleanups.push(cleanup);};`,
 '@tanstack/react-query':`export const useQueryClient=()=>globalThis.__gpsCache.client;export const useQuery=options=>{globalThis.__gpsCache.query=options;return {data:globalThis.__gpsCache.data,refetch:async()=>{}};};`,
 '@/core/realtime/socket':`export const openSocket=(path,callback)=>{globalThis.__gpsCache.path=path;globalThis.__gpsCache.emit=callback;return {close:()=>{globalThis.__gpsCache.closed=true;}};};`,
 '../data/driverLocationRepository':`export const driverLocationRepository={get:(...args)=>globalThis.__gpsCache.get(...args)};export const toDriverLocation=value=>value;export const driverLocationMessageSchema={};`,
};
const hooks=registerHooks({
 resolve(name,context,next){if(name in mocks)return {url:'gps-cache:'+name,shortCircuit:true};if(name==='../domain/driverLocation')return next(new URL('../src/features/tracking/domain/driverLocation.ts',import.meta.url).href,context);return next(name,context);},
 load(url,context,next){if(url.startsWith('gps-cache:'))return {format:'module',shortCircuit:true,source:mocks[url.slice(10)]};if(url.endsWith('.ts'))return {format:'module',shortCircuit:true,source:ts.transpileModule(readFileSync(new URL(url),'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext},fileName:url}).outputText};return next(url,context);}
});
const {useDriverLocation}=await import('../src/features/tracking/application/useDriverLocation.ts');hooks.deregister();
const ride={id:'r1',status:'accepted',driver:{id:'d1'}};
const point={rideId:'r1',driverId:'d1',latitude:-16.5,longitude:-68.13,capturedAt:new Date().toISOString()};
function reset(){state.cleanups.forEach(fn=>fn());state.cleanups=[];state.data=null;state.emit=null;state.closed=false;state.client={getQueryData:()=>state.data,setQueryData:(key,update)=>{state.data=typeof update==='function'?update(state.data):update;}};}
test('slow empty HTTP response cannot erase a GPS frame that arrived through WS',async()=>{
 reset();let resolve;state.get=()=>new Promise(done=>{resolve=done;});useDriverLocation(ride);
 const pending=state.query.queryFn({signal:new AbortController().signal});state.emit({data:point});resolve(null);
 assert.equal(await pending,point);assert.equal(state.path,'/ws/rides/r1/driver-location');
});
test('another driver or trip cannot replace the location shown to a passenger',()=>{
 reset();useDriverLocation(ride);state.emit({data:point});
 state.emit({data:{...point,rideId:'r2'}});state.emit({data:{...point,driverId:'d2'}});assert.equal(state.data,point);
});
test('completed and cancelled trips hide cached GPS and do not open a socket',()=>{
 for(const status of ['completed','cancelled']){reset();state.data=point;const result=useDriverLocation({...ride,status});assert.equal(result.location,null);assert.equal(state.query.enabled,false);assert.equal(state.emit,null);}
});
test('leaving tracking closes its private socket',()=>{reset();useDriverLocation(ride);state.cleanups.forEach(fn=>fn());state.cleanups=[];assert.equal(state.closed,true);});
test.after(reset);
