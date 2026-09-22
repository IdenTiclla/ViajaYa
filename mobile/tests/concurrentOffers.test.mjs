import assert from 'node:assert/strict';
import test from 'node:test';
import { registerHooks } from 'node:module';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

// A hook runner keeps refs and state across renders; promises are controlled independently.
const state = { slots: [], cursor: 0, send: null };
globalThis.__concurrentOffers = state;
const mocks = {
  '@tanstack/react-query': `export const useMutationState=options=>(globalThis.__concurrentOffers.shared||[]).map(options.select); export const useQueryClient=()=>({isMutating:options=>(globalThis.__concurrentOffers.shared||[]).filter(options.predicate).length});`,
  react: `const state=globalThis.__concurrentOffers;
    export function useRef(initial){const index=state.cursor++; return state.slots[index]??=( {current:initial});}
    export function useState(initial){const index=state.cursor++; if(!(index in state.slots))state.slots[index]=initial;
      return [state.slots[index], value=>{state.slots[index]=typeof value==='function'?value(state.slots[index]):value;}];}`,
  './useAutomaticOffer': 'export const AUTOMATIC_OFFER_KEY=["automatic-driver-offer"]; export const useAutomaticOffer=()=>({mutateAsync:input=>globalThis.__concurrentOffers.send(input)});',
};
const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier in mocks) return {url:`concurrent-offers:${specifier}`,shortCircuit:true};
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url.startsWith('concurrent-offers:')) return {format:'module',shortCircuit:true,source:mocks[url.slice(18)]};
    if (url.endsWith('/useConcurrentOffers.ts')) return {format:'module',shortCircuit:true,source:ts.transpileModule(readFileSync(new URL(url),'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext},fileName:url}).outputText};
    return nextLoad(url,context);
  },
});
const { useConcurrentOffers } = await import('../src/features/driver/application/useConcurrentOffers.ts');
hooks.deregister();
const render=()=>{state.cursor=0;return useConcurrentOffers();};
const settle=()=>new Promise(resolve=>setImmediate(resolve));
function setup(){
  state.slots=[];state.shared=[];const calls=[];
  state.send=input=>new Promise((resolve,reject)=>calls.push({input,resolve,reject}));
  return {calls,hook:render()};
}

test('overlapping submissions retain both callbacks when responses arrive in reverse order',async()=>{
  const {hook,calls}=setup();const applied=[];
  hook.mutate({rideId:'a'},{onSuccess:offer=>applied.push(['a',offer.id])});
  hook.mutate({rideId:'b'},{onSuccess:offer=>applied.push(['b',offer.id])});
  assert.deepEqual([...render().pendingRideIds],['a','b']);
  calls[1].resolve({id:'b-offer'});await settle();
  assert.deepEqual([...render().pendingRideIds],['a']);
  calls[0].resolve({id:'a-offer'});await settle();
  assert.deepEqual(applied,[['b','b-offer'],['a','a-offer']]);assert.equal(render().isPending,false);
});

test('duplicate taps are blocked per passenger without blocking a different passenger',async()=>{
  const {hook,calls}=setup();
  hook.mutate({rideId:'a'});hook.mutate({rideId:'a'});hook.mutate({rideId:'b'});
  assert.equal(calls.length,2);assert.equal(hook.isRidePending('a'),true);
  calls.forEach(call=>call.resolve({id:call.input.rideId}));await settle();
  assert.equal(hook.isRidePending('a'),false);
});

test('one failed offer can be retried without replacing or repeating another offer',async()=>{
  const {hook,calls}=setup();const successes=[],errors=[];
  hook.mutate({rideId:'a'},{onError:error=>errors.push(error.message),onSuccess:offer=>successes.push(offer.id)});
  hook.mutate({rideId:'b'},{onSuccess:offer=>successes.push(offer.id)});
  calls[0].reject(new Error('GPS unavailable'));calls[1].resolve({id:'b'});await settle();
  const failed=render().failures[0];assert.equal(failed.input.rideId,'a');assert.deepEqual(successes,['b']);
  render().mutate(failed.input,failed.callbacks);calls[2].resolve({id:'a'});await settle();
  assert.deepEqual(successes,['b','a']);assert.deepEqual(errors,['GPS unavailable']);assert.equal(render().failures.length,0);
  assert.deepEqual(calls.map(call=>call.input.rideId),['a','b','a']);
});

test('dismissing one error preserves another failed negotiation',async()=>{
  const {hook,calls}=setup();hook.mutate({rideId:'a'});hook.mutate({rideId:'b'});
  calls.forEach(call=>call.reject(new Error('Network unavailable')));await settle();
  render().dismissError('a');assert.deepEqual(render().failures.map(f=>f.input.rideId),['b']);
});

test('an in-flight offer from a previous screen remains busy after navigation',async()=>{
  const {calls}=setup();state.shared=[{state:{variables:{rideId:'a'}}}];
  const hook=render();assert.deepEqual([...hook.pendingRideIds],['a']);
  hook.mutate({rideId:'a'});hook.mutate({rideId:'b'});
  assert.deepEqual(calls.map(call=>call.input.rideId),['b']);
  calls[0].resolve({id:'b'});await settle();
});
