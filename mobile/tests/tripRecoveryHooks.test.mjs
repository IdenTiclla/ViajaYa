import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import test from 'node:test';
import ts from 'typescript';

const repository = {};
const booking = {};
const state = { repository, booking, query: null };
globalThis.__tripRecoveryTest = state;
const mocks = {
  '@tanstack/react-query': `export const useMutation = options => options;
    export const useQueryClient = () => ({});
    export const useQuery = options => { globalThis.__tripRecoveryTest.query = options; return {}; };
    export const useInfiniteQuery = useQuery;`,
  '@/store/authStore': 'export const useAuthStore = select => select({user:{role:"driver"}});',
  '@/features/driver/application/useDriverRequests': 'export const useDriverRequests = {};',
  'test:rides': 'export const ridesRepository = globalThis.__tripRecoveryTest.repository;',
  'test:booking': 'export const ridesRepository = globalThis.__tripRecoveryTest.booking;',
};
const sourceRoot = new URL('../src/', import.meta.url);
const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    let target = specifier;
    if (target.endsWith('/ridesRepository')) {
      const isBooking = target.includes('/booking/') || context.parentURL?.includes('/booking/application/');
      target = isBooking && !target.startsWith('@/features/rides/') ? 'test:booking' : 'test:rides';
    }
    if (target in mocks) return { url: `recovery-mock:${target}`, shortCircuit: true };
    if (target.startsWith('@/')) target = new URL(target.slice(2), sourceRoot).href;
    if (target.startsWith('.') || target.startsWith('file:')) {
      const url = new URL(target, context.parentURL);
      const path = fileURLToPath(url);
      if (existsSync(path + '.ts')) return nextResolve(pathToFileURL(path + '.ts').href, context);
    }
    return nextResolve(target, context);
  },
  load(url, context, nextLoad) {
    if (url.startsWith('recovery-mock:')) return {format:'module',shortCircuit:true,source:mocks[url.slice(14)]};
    if (url.endsWith('.ts') && !url.includes('/node_modules/')) return {
      format:'module',shortCircuit:true,source:ts.transpileModule(readFileSync(new URL(url),'utf8'), {
        compilerOptions:{module:ts.ModuleKind.ESNext},fileName:url,
      }).outputText,
    };
    return nextLoad(url,context);
  },
});
const { useUpdateRideStatus, useEditRide, useMarkRiderOnTheWay, useAcceptOffer } = await import('../src/features/rides/application/useRideMutations.ts');
const { useRateRide } = await import('../src/features/rides/application/useCloseFlow.ts');
const { useDriverActiveRide } = await import('../src/features/rides/application/useRides.ts');
const { useCreateRide } = await import('../src/features/booking/application/useCreateRide.ts');
hooks.deregister();
const lost = new Error('Lost response');
const rejectWrite = async () => { throw lost; };

test('create hook recovers the existing request instead of asking for another POST', async () => {
  booking.create = rejectWrite;
  const ride = {id:'created',status:'searching'};
  repository.getPassengerActiveRide = async () => ride;
  assert.equal(await useCreateRide().mutationFn({}),ride);
  repository.getPassengerActiveRide = async () => null;
  await assert.rejects(useCreateRide().mutationFn({}),error=>error===lost);
});
test('edit hook recovers publication and preserves a draft when still paused', async () => {
  repository.editRide = rejectWrite;
  const ride = {id:'edited',status:'searching',paused:false};
  repository.getRide = async id => {assert.equal(id,ride.id);return ride;};
  assert.equal(await useEditRide().mutationFn({rideId:ride.id,input:{}}),ride);
  ride.paused = true;
  await assert.rejects(useEditRide().mutationFn({rideId:ride.id,input:{}}),error=>error===lost);
});
test('completion hook restores the terminal ride and rejects a failed transition', async () => {
  repository.updateStatus = rejectWrite;
  const ride = {id:'completed',status:'completed'};
  repository.getRide = async () => ride;
  assert.equal(await useUpdateRideStatus().mutationFn({rideId:ride.id,status:'completed'}),ride);
  ride.status = 'in_progress';
  await assert.rejects(useUpdateRideStatus().mutationFn({rideId:ride.id,status:'completed'}),error=>error===lost);
});
test('rating hook verifies the exact ride and does not swallow a missing rating', async () => {
  repository.rateRide = rejectWrite;
  repository.hasRating = async id => {assert.equal(id,'rated-ride');return true;};
  assert.equal(await useRateRide().mutationFn({rideId:'rated-ride',input:{score:5}}),true);
  repository.hasRating = async () => false;
  await assert.rejects(useRateRide().mutationFn({rideId:'rated-ride',input:{score:5}}),error=>error===lost);
});
test('driver pool waits for the authoritative closing state after active becomes null', async () => {
  repository.getActiveRide = async () => null;
  let finish;
  repository.getPendingRatingRide = () => new Promise(resolve => {finish=resolve;});
  useDriverActiveRide();
  let settled=false;
  const query = state.query.queryFn({signal:undefined}).then(value=>{settled=true;return value;});
  await Promise.resolve(); await Promise.resolve();
  assert.equal(settled,false);
  const ride={id:'terminal',status:'completed'};
  finish(ride);
  assert.equal(await query,ride);
  repository.getPendingRatingRide = async () => {throw new Error('Offline');};
  await assert.rejects(state.query.queryFn({signal:undefined}),/Offline/);
});

test('pickup hook confirms a saved notice and preserves an unsent action on failure', async () => {
  repository.markRiderOnTheWay = rejectWrite;
  const ride = {id:'pickup',status:'arriving',riderOnTheWayAt:'2026-09-19T16:00:00Z'};
  repository.getRide = async id => {assert.equal(id,'pickup');return ride;};
  assert.equal(await useMarkRiderOnTheWay().mutationFn('pickup'),ride);
  ride.riderOnTheWayAt=null;
  await assert.rejects(useMarkRiderOnTheWay().mutationFn('pickup'),error=>error===lost);
  ride.status='in_progress';
  assert.equal(await useMarkRiderOnTheWay().mutationFn('pickup'),ride);
});
test('acceptance recovers the assigned ride without masking a searching request', async () => {
  repository.acceptOffer = rejectWrite;
  const ride = {id:'assigned',status:'accepted',driver:{id:'driver'}};
  repository.getRide = async () => ride;
  const vars={rideId:ride.id,offerId:'selected'};
  assert.equal(await useAcceptOffer().mutationFn(vars),ride);
  ride.status='searching';
  await assert.rejects(useAcceptOffer().mutationFn(vars),error=>error===lost);
  ride.status='cancelled';
  await assert.rejects(useAcceptOffer().mutationFn(vars),error=>error===lost);
});
