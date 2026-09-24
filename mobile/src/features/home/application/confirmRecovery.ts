/** Check the active ride and pending rating with a single time limit for the whole recovery. */
type QueryOutcome = {
  isSuccess: boolean;
  data?: unknown;
  error: unknown;
};

type Fetcher = () => Promise<QueryOutcome>;

export async function confirmRecovery(
  fetchActive: Fetcher,
  fetchRating: Fetcher,
  limitMs = 30_000,
): Promise<void> {
  let exhausted = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const limit = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      exhausted = true;
      reject(new Error('La verificación tardó demasiado. Revisa tu conexión y vuelve a intentar.'));
    }, limitMs);
  });
  const verify = async () => {
    const active = await fetchActive();
    if (exhausted) return;
    if (!active.isSuccess) throw active.error;
    if (active.data == null) {
      const rating = await fetchRating();
      if (!rating.isSuccess) throw rating.error;
    }
  };
  try {
    // It also bounds queries paused by connectivity or internal retries.
    await Promise.race([verify(), limit]);
  } finally {
    clearTimeout(timer);
  }
}
