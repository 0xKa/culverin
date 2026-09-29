export const AUTO_COUNT_KEY = "github.autoCount";
export const AUTO_COUNT_ENTRIES = 200;

export type ClaimStorage = {
  get(key: string): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
};

export function autoCountClaims(
  storage: ClaimStorage,
): (identity: string) => Promise<boolean> {
  let tail: Promise<unknown> = Promise.resolve();
  return (identity) => {
    const task = tail.then(async () => {
      const stored = (await storage.get(AUTO_COUNT_KEY))[AUTO_COUNT_KEY];
      const claimed = Array.isArray(stored)
        ? stored.filter((item): item is string => typeof item === "string")
        : [];
      if (claimed.includes(identity)) return false;
      await storage.set({
        [AUTO_COUNT_KEY]: [...claimed, identity].slice(-AUTO_COUNT_ENTRIES),
      });
      return true;
    });
    tail = task.catch(() => undefined);
    return task.catch(() => false);
  };
}
