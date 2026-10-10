import { expect, test } from "bun:test";
import {
  countFormat,
  COUNT_FORMAT_KEY,
  sizeUnits,
  SIZE_UNITS_KEY,
  subscribeNumberFormats,
} from "../../extension/src/appearance/numbers";
import type { NumberFormats } from "../../extension/src/ui/format";
import { deferred, event, settle } from "./support/events";

function storage(initial: Record<string, unknown> = {}) {
  const values = new Map(Object.entries(initial));
  return {
    values,
    get: async (key: string) => ({ [key]: values.get(key) }),
    set: async (items: Record<string, unknown>) => {
      for (const [key, value] of Object.entries(items)) values.set(key, value);
    },
    remove: async (key: string) => void values.delete(key),
  };
}

const changes = () =>
  event<
    (
      changes: Record<string, chrome.storage.StorageChange>,
      area: string,
    ) => void
  >();

test("persists independent formatting choices and removes defaults without touching theme or contrast", async () => {
  const saved = storage({
    "culverin.theme": "dark",
    "culverin.highContrast": true,
  });
  expect(await countFormat.read(saved)).toBe("full");
  expect(await sizeUnits.read(saved)).toBe("binary");
  await countFormat.write("abbreviated", saved);
  await sizeUnits.write("decimal", saved);
  await countFormat.write("full", saved);
  expect(await sizeUnits.read(saved)).toBe("decimal");
  await sizeUnits.write("binary", saved);
  expect(Object.fromEntries(saved.values)).toEqual({
    "culverin.theme": "dark",
    "culverin.highContrast": true,
  });
  for (const value of [null, true, 1, "compact", {}, undefined]) {
    const invalid = storage({
      [COUNT_FORMAT_KEY]: value,
      [SIZE_UNITS_KEY]: value,
    });
    expect(await countFormat.read(invalid)).toBe("full");
    expect(await sizeUnits.read(invalid)).toBe("binary");
  }
});

test("uses defaults when storage cannot be read and exposes save failures", async () => {
  const unavailable = {
    ...storage(),
    get: async (): Promise<Record<string, unknown>> => {
      throw new Error("unavailable");
    },
    set: async () => {
      throw new Error("unavailable");
    },
    remove: async () => {
      throw new Error("unavailable");
    },
  };
  expect(await countFormat.read(unavailable)).toBe("full");
  expect(await sizeUnits.read(unavailable)).toBe("binary");
  await expect(countFormat.write("abbreviated", unavailable)).rejects.toThrow(
    "unavailable",
  );
  await expect(sizeUnits.write("binary", unavailable)).rejects.toThrow(
    "unavailable",
  );
});

test("keeps each live preference ahead of stale reads and ignores unrelated storage changes", async () => {
  const counts = deferred<Record<string, unknown>>();
  const sizes = deferred<Record<string, unknown>>();
  const changed = changes();
  const published: NumberFormats[] = [];
  const stop = subscribeNumberFormats((formats) => published.push(formats), {
    storage: {
      ...storage(),
      get: (key) => (key === COUNT_FORMAT_KEY ? counts.promise : sizes.promise),
    },
    changes: changed,
  });
  changed.emit({ [COUNT_FORMAT_KEY]: { newValue: "abbreviated" } }, "sync");
  counts.resolve({ [COUNT_FORMAT_KEY]: "full" });
  sizes.resolve({ [SIZE_UNITS_KEY]: "decimal" });
  await settle();
  expect(published.at(-1)).toEqual({ counts: "abbreviated", sizes: "decimal" });
  const length = published.length;
  changed.emit({ [COUNT_FORMAT_KEY]: { newValue: "full" } }, "local");
  changed.emit({ "culverin.theme": { newValue: "light" } }, "sync");
  expect(published).toHaveLength(length);
  changed.emit({ [SIZE_UNITS_KEY]: {} }, "sync");
  expect(published.at(-1)).toEqual({ counts: "abbreviated", sizes: "binary" });
  changed.emit({ [COUNT_FORMAT_KEY]: { newValue: "invalid" } }, "sync");
  expect(published.at(-1)).toEqual({ counts: "full", sizes: "binary" });
  stop();
  expect(changed.listeners.size).toBe(0);
});

test("does not publish startup reads after disposal", async () => {
  const reading = deferred<Record<string, unknown>>();
  const changed = changes();
  const published: NumberFormats[] = [];
  const stop = subscribeNumberFormats((formats) => published.push(formats), {
    storage: { ...storage(), get: () => reading.promise },
    changes: changed,
  });
  stop();
  reading.resolve({
    [COUNT_FORMAT_KEY]: "abbreviated",
    [SIZE_UNITS_KEY]: "decimal",
  });
  await settle();
  expect(published).toEqual([]);
  expect(changed.listeners.size).toBe(0);
});
