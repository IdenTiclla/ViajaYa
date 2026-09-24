/** Bound a wait; a late resolution no longer changes its result. */
export function withTimeout<T>(
  operation: Promise<T>,
  limitMs: number,
  message: string,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), limitMs);
    operation.then(
      (result) => { clearTimeout(timer); resolve(result); },
      (error: unknown) => { clearTimeout(timer); reject(error); },
    );
  });
}
