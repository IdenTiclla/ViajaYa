/** Cola serial por generación para descartar callbacks de sockets reemplazados. */

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
      // La conexión nueva no espera a un handler viejo que podría quedar
      // bloqueado en IO. Su cadena continúa aislada y los guards la descartan.
      queue = Promise.resolve();
      return generation;
    },
    enqueue,
  };
}
