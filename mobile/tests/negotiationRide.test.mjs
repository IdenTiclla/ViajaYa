import assert from 'node:assert/strict';
import test from 'node:test';
import { registerHooks } from 'node:module';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

const state = {};globalThis.__negotiationRideTest = state;
const mocks = {
  react: 'export const useEffect=effect=>effect();',
  '@/features/rides/application/useRides': 'export const useOpenRides=enabled=>{globalThis.__negotiationRideTest.enabled=enabled;return globalThis.__negotiationRideTest.query;};',
};
const hooks=registerHooks({
  resolve(name,context,next){return name in mocks?{url:'negotiation-test:'+name,shortCircuit:true}:next(name,context);},
  load(url,context,next){
    if(url.startsWith('negotiation-test:'))return {format:'module',shortCircuit:true,source:mocks[url.slice(17)]};
    if(url.endsWith('/useNegotiationRide.ts'))return {format:'module',shortCircuit:true,source:ts.transpileModule(readFileSync(new URL(url),'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext},fileName:url}).outputText};
    return next(url,context);
  },
});
const {useNegotiationRide}=await import('../src/features/driver/application/useNegotiationRide.ts');hooks.deregister();
function setup(overrides={}){
  state.pages=0;state.refetches=0;
  state.query={rides:[{id:'other'}],hasNextPage:true,isLoading:false,isError:false,isFetchingNextPage:false,isFetchNextPageError:false,
    fetchNextPage:()=>{state.pages++;},refetch:()=>{state.refetches++;},...overrides};
}

test('an offer outside loaded pages stays loading while the next page is fetched',()=>{
  setup();assert.equal(useNegotiationRide('wanted',true).isLoading,true);assert.equal(state.pages,1);
  state.query.isFetchingNextPage=true;useNegotiationRide('wanted',true);assert.equal(state.pages,1);
});
test('finding the request stops pagination and returns its current data',()=>{
  const ride={id:'wanted',poolVersion:3};setup({rides:[ride]});
  const result=useNegotiationRide('wanted',true);assert.equal(result.ride,ride);assert.equal(result.isLoading,false);assert.equal(state.pages,0);
});
test('a failed later page waits for explicit retry of that page',()=>{
  setup({isError:true,isFetchNextPageError:true});const result=useNegotiationRide('wanted',true);
  assert.equal(result.isLoading,false);assert.equal(result.isError,true);assert.equal(state.pages,0);
  result.refetch();assert.equal(state.pages,1);assert.equal(state.refetches,0);
});
test('exhausted pages and an assigned trip do not start more pool requests',()=>{
  setup({hasNextPage:false});assert.equal(useNegotiationRide('wanted',true).isLoading,false);assert.equal(state.pages,0);
  setup();useNegotiationRide('wanted',false);assert.equal(state.enabled,false);assert.equal(state.pages,0);
});
