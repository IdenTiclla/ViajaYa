import assert from 'node:assert/strict';
import test from 'node:test';

import { createGenerationMessageQueue } from '../src/core/realtime/socketQueue.ts';

function deferred() {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

test('descarta mensajes encolados de una generación reemplazada', async () => {
  const queue = createGenerationMessageQueue();
  const release = deferred();
  const started = deferred();
  const completed = deferred();
  const calls = [];
  const oldGeneration = queue.currentGeneration();

  queue.enqueue(
    oldGeneration,
    async () => {
      calls.push('old-running');
      started.resolve();
      await release.promise;
    },
    () => calls.push('old-error'),
  );
  queue.enqueue(
    oldGeneration,
    () => calls.push('old-queued'),
    () => calls.push('old-error'),
  );
  await started.promise;
  const newGeneration = queue.advanceGeneration();
  queue.enqueue(
    newGeneration,
    () => {
      calls.push('new');
      completed.resolve();
    },
    () => calls.push('new-error'),
  );

  release.resolve();
  await completed.promise;

  assert.deepEqual(calls, ['old-running', 'new']);
});

test('reporta error solo si la generación sigue vigente', async () => {
  const queue = createGenerationMessageQueue();
  const completed = deferred();
  const generation = queue.currentGeneration();
  let errors = 0;

  queue.enqueue(
    generation,
    () => {
      throw new Error('fallo');
    },
    () => {
      errors += 1;
      completed.resolve();
    },
  );
  await completed.promise;

  assert.equal(errors, 1);
});
