import { afterEach, expect, jest, test } from "bun:test";
import {
  subscribeRateLimit,
  type RateLimitSnapshot,
} from "../../extension/src/github/rate-limit-observer";
import {
  currentRemaining,
  RATE_LIMIT_KEY,
} from "../../extension/src/github/rate-limit";
import { deferred, event, settle } from "./support/events";

afterEach(() => jest.useRealTimers());
function observer() {
  const read = deferred<Record<string, unknown>>();
  const changes =
    event<
      (
        changes: Record<string, chrome.storage.StorageChange>,
        area: string,
      ) => void
    >();
  const snapshots: RateLimitSnapshot[] = [];
  const dependencies = {
    storage: { get: () => read.promise } as Pick<
      chrome.storage.StorageArea,
      "get"
    >,
    changes,
  };
  const dispose = subscribeRateLimit(
    (snapshot) => snapshots.push(snapshot),
    dependencies,
  );
  const change = (value?: unknown, area = "session", key = RATE_LIMIT_KEY) =>
    changes.emit({ [key]: { newValue: value } }, area);
  return { read, snapshots, dispose, changes, change, dependencies };
}

test("storage events win a deferred initial read and invalid values clear the account display", async () => {
  jest.useFakeTimers();
  const ui = observer();
  const next = {
    limit: 5000,
    remaining: 4000,
    reset: Date.now() + 5000,
    authenticated: true as const,
  };
  ui.change(next);
  ui.read.resolve({
    [RATE_LIMIT_KEY]: { limit: 60, remaining: 1, reset: Date.now() + 5000 },
  });
  await settle();
  expect(ui.snapshots).toHaveLength(1);
  expect(ui.snapshots[0]?.value).toEqual(next);
  ui.change(undefined, "local");
  ui.change(undefined, "session", "other");
  expect(ui.snapshots).toHaveLength(1);
  ui.change({ limit: "bad" });
  expect(ui.snapshots.at(-1)?.value).toBeUndefined();
  ui.dispose();
  expect(jest.getTimerCount()).toBe(0);
});

test("reset publishes full allowance locally, changed resets reschedule, subscribers dispose independently", async () => {
  jest.useFakeTimers();
  const ui = observer();
  const other: RateLimitSnapshot[] = [];
  const stop = subscribeRateLimit(
    (value) => other.push(value),
    ui.dependencies,
  );
  ui.read.resolve({});
  await settle();
  ui.change({ limit: 60, remaining: 2, reset: Date.now() + 1000 });
  ui.change({ limit: 60, remaining: 3, reset: Date.now() + 3000 });
  ui.dispose();
  ui.dispose();
  const size = ui.snapshots.length;
  jest.advanceTimersByTime(3000);
  const snapshot = other.at(-1)!;
  expect(currentRemaining(snapshot.value!, snapshot.now)).toBe(60);
  expect(ui.snapshots).toHaveLength(size);
  expect(ui.changes.listeners.size).toBe(1);
  stop();
  expect(ui.changes.listeners.size).toBe(0);
  expect(jest.getTimerCount()).toBe(0);
});

test("disposal suppresses late reads and failures publish unknown without rejection", async () => {
  const late = observer();
  late.dispose();
  late.read.resolve({});
  const failed = observer();
  failed.read.reject(new Error("Unavailable"));
  await settle();
  expect(late.snapshots).toEqual([]);
  expect(failed.snapshots).toHaveLength(1);
  expect(failed.snapshots[0]?.value).toBeUndefined();
  failed.dispose();
});
