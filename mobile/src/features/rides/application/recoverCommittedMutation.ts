/** A failed reply is not proof that a write failed. Only server evidence closes it. */
export async function recoverCommittedMutation<T>(
  write: () => Promise<T>,
  read: () => Promise<T | null>,
  isCommitted: (value: T) => boolean,
): Promise<T> {
  try {
    return await write();
  } catch (error) {
    try {
      const saved = await read();
      if (saved !== null && isCommitted(saved)) return saved;
    } catch {
      // Keep the original failure and the user's draft when recovery is unavailable.
    }
    throw error;
  }
}
