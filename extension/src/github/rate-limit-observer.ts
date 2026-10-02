import { RATE_LIMIT_KEY, validRateLimit, type RateLimit } from "./rate-limit";

export type RateLimitSnapshot = { value: RateLimit | undefined; now: number };
type Dependencies = {
  storage: Pick<chrome.storage.StorageArea, "get">;
  changes: Pick<
    typeof chrome.storage.onChanged,
    "addListener" | "removeListener"
  >;
  now?: () => number;
};

export function subscribeRateLimit(
  publish: (snapshot: RateLimitSnapshot) => void,
  dependencies: Dependencies = {
    storage: chrome.storage.session,
    changes: chrome.storage.onChanged,
  },
): () => void {
  let disposed = false;
  let revision = 0;
  let value: RateLimit | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const now = dependencies.now ?? Date.now;
  const show = () => {
    if (disposed) return;
    clearTimeout(timer);
    timer = undefined;
    const time = now();
    publish({ value, now: time });
    if (value && value.reset > time)
      timer = setTimeout(show, Math.min(value.reset - time, 2_147_483_647));
  };
  const accept = (next: unknown) => {
    value = validRateLimit(next) ? next : undefined;
    show();
  };
  const changed = (
    changes: Record<string, chrome.storage.StorageChange>,
    area: string,
  ) => {
    if (disposed || area !== "session" || !(RATE_LIMIT_KEY in changes)) return;
    revision++;
    accept(changes[RATE_LIMIT_KEY]!.newValue);
  };
  dependencies.changes.addListener(changed);
  void dependencies.storage.get(RATE_LIMIT_KEY).then(
    (state) => {
      if (!disposed && revision === 0) accept(state[RATE_LIMIT_KEY]);
    },
    () => {
      if (!disposed && revision === 0) accept(undefined);
    },
  );
  return () => {
    if (disposed) return;
    disposed = true;
    dependencies.changes.removeListener(changed);
    clearTimeout(timer);
  };
}
