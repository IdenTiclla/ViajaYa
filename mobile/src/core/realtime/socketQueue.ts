/** Serial queue per generation to discard callbacks of replaced sockets. */

export type GenerationMessageQueue = {
  currentGeneration: () => number;
  advanceGeneration: () => number;
  enqueue: (
    generation: number,
    handler: () => void | Promise<void>,
    onError: () => void,
  ) => void;
};

export function createGenerationMessageQueue(): GenerationMessageQueue {
  let generation = 0;
  let queue: Promise<void> = Promise.resolve();

  const enqueue: GenerationMessageQueue['enqueue'] = (
    expectedGeneration,
    handler,
    onError,
  ) => {
    queue = queue.then(async () => {
      if (expectedGeneration !== generation) return;
      try {
        await handler();
      } catch {
        if (expectedGeneration === generation) onError();
      }
    });
  };

  return {
    currentGeneration: () => generation,
    advanceGeneration: () => {
      generation += 1;
      // The new connection does not wait for an old handler that could stay
      // blocked on IO. Its chain continues in isolation and the guards discard it.
      queue = Promise.resolve();
      return generation;
    },
    enqueue,
  };
}
