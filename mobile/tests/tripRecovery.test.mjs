import { reduceRideMutationResult, shouldApplyRideStatus } from '../src/features/rides/application/rideStatusReducer.ts';
import assert from 'node:assert/strict';
import test from 'node:test';
import { recoverCommittedMutation } from '../src/features/rides/application/recoverCommittedMutation.ts';
import { arrivalMinutesFromSeconds } from '../src/features/rides/domain/offerArrivalTime.ts';
import { routeTravelMode } from '../src/features/booking/domain/routeTravelMode.ts';

for (const recovered of [null, { id: 'ride-1', committed: false }]) {
  test(`uncommitted write preserves the original failure: ${JSON.stringify(recovered)}`, async () => {
    const original = new Error('Not saved');
    await assert.rejects(recoverCommittedMutation(
      async () => { throw original; }, async () => recovered, (ride) => ride.committed,
    ), (error) => error === original);
  });
}
test('a recovery read failure does not claim that the mutation succeeded', async () => {
  const original = new Error('Connection lost');
  await assert.rejects(recoverCommittedMutation(
    async () => { throw original; }, async () => { throw new Error('Offline'); }, () => true,
  ), (error) => error === original);
});
test('successful writes never wait for another network request', async () => {
  assert.equal(await recoverCommittedMutation(async () => true,
    () => { throw new Error('Unnecessary read'); }, () => true), true);
});
test('automatic pickup minutes round up and reject invalid provider durations', () => {
  for (const value of [NaN, Infinity, -1, 14401]) assert.equal(arrivalMinutesFromSeconds(value), null);
  for (const [seconds, minutes] of [[0,1],[1,1],[60,1],[60.1,2],[299,5],[14400,240]]) {
    assert.equal(arrivalMinutesFromSeconds(seconds), minutes);
  }
});
test('motorcycle routing uses two-wheel mode and never the taxi profile', () => {
  assert.equal(routeTravelMode('moto'), 'TWO_WHEELER');
  for (const service of ['taxi', 'delivery', 'moving']) assert.equal(routeTravelMode(service), 'DRIVE');
});

test('a stale arriving event cannot erase a confirmed passenger pickup notice', () => {
  const current={id:'ride',status:'arriving',riderOnTheWayAt:'2026-09-19T16:00:00Z'};
  const stale={...current,riderOnTheWayAt:null};
  assert.equal(shouldApplyRideStatus(current,stale),false);
  assert.deepEqual(reduceRideMutationResult(current,stale),{ride:current,applied:false});
  assert.equal(shouldApplyRideStatus(stale,current),true);
  assert.equal(shouldApplyRideStatus(current,{...current,status:'in_progress'}),true);
  assert.equal(shouldApplyRideStatus({...current,status:'completed'},current),false);
});
