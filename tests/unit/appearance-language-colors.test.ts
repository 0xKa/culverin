import { expect, test } from "bun:test";
import {
  applyLanguageColors,
  followLanguageColors,
  LANGUAGE_COLORS_KEY,
  languageColors,
  readRememberedLanguageColors,
  rememberLanguageColors,
  subscribeLanguageColors,
  type LanguageColorMode,
} from "../../extension/src/appearance/language-colors";
import {
  highContrast,
  HIGH_CONTRAST_KEY,
} from "../../extension/src/appearance/contrast";
import { deferred, event, settle } from "./support/events";

function memoryStorage(initial: Record<string, unknown> = {}) {
  const values = new Map(Object.entries(initial));
  return {
    values,
    get: async (key: string) =>
      values.has(key) ? { [key]: values.get(key) } : {},
    set: async (items: Record<string, unknown>) => {
      for (const [key, value] of Object.entries(items)) values.set(key, value);
    },
    remove: async (key: string) => void values.delete(key),
  };
}

function rememberedStorage() {
  const values = new Map<string, string>();
  return {
    values,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
    removeItem: (key: string) => void values.delete(key),
  };
}

function replaceGlobal(name: string, value: unknown): () => void {
  const original = Object.getOwnPropertyDescriptor(globalThis, name);
  Object.defineProperty(globalThis, name, { configurable: true, value });
  return () => {
    if (original) Object.defineProperty(globalThis, name, original);
    else Reflect.deleteProperty(globalThis, name);
  };
}

type Listener = (
  changes: Record<string, chrome.storage.StorageChange>,
  area: string,
) => void;

test("defaults to language colors, saves single color independently, and removes the default", async () => {
  const storage = memoryStorage({ [HIGH_CONTRAST_KEY]: true });
  expect(await languageColors.read(storage)).toBe("language");
  await languageColors.write("single", storage);
  expect(await languageColors.read(storage)).toBe("single");
  expect(await highContrast.read(storage)).toBe(true);
  await languageColors.write("language", storage);
  expect(Object.fromEntries(storage.values)).toEqual({
    [HIGH_CONTRAST_KEY]: true,
  });
});

test("uses language colors for invalid or unavailable synced storage", async () => {
  for (const value of ["Single", "accent", true, 1, null, undefined]) {
    expect(
      await languageColors.read(
        memoryStorage({ [LANGUAGE_COLORS_KEY]: value }),
      ),
    ).toBe("language");
  }
  expect(
    await languageColors.read({
      ...memoryStorage(),
      get: async () => {
        throw new Error("unavailable");
      },
    }),
  ).toBe("language");
});

test("applies and remembers single color locally and tolerates unavailable storage", () => {
  const storage = rememberedStorage();
  const root = { dataset: { theme: "dark" } as DOMStringMap };
  expect(readRememberedLanguageColors(storage)).toBe("language");
  rememberLanguageColors("single", storage);
  applyLanguageColors(readRememberedLanguageColors(storage), root);
  expect(root.dataset).toEqual({ theme: "dark", languageColors: "single" });
  rememberLanguageColors("language", storage);
  applyLanguageColors(readRememberedLanguageColors(storage), root);
  expect(root.dataset).toEqual({ theme: "dark" });
  expect(storage.values.has(LANGUAGE_COLORS_KEY)).toBe(false);
  storage.values.set(LANGUAGE_COLORS_KEY, "invalid");
  expect(readRememberedLanguageColors(storage)).toBe("language");
  const broken = {
    getItem: (): string | null => {
      throw new Error("unavailable");
    },
    setItem: () => {
      throw new Error("unavailable");
    },
    removeItem: () => {
      throw new Error("unavailable");
    },
  };
  expect(readRememberedLanguageColors(broken)).toBe("language");
  expect(() => rememberLanguageColors("single", broken)).not.toThrow();
});

test("subscription keeps newer changes ahead of a stale read, ignores unrelated events, and cleans up", async () => {
  const reading = deferred<Record<string, unknown>>();
  const changes = event<Listener>();
  const published: LanguageColorMode[] = [];
  const unsubscribe = subscribeLanguageColors((mode) => published.push(mode), {
    storage: { ...memoryStorage(), get: () => reading.promise },
    changes,
  });
  changes.emit({ [LANGUAGE_COLORS_KEY]: { newValue: "single" } }, "sync");
  reading.resolve({});
  await settle();
  expect(published).toEqual(["single"]);
  changes.emit({ [HIGH_CONTRAST_KEY]: { newValue: true } }, "sync");
  changes.emit({ [LANGUAGE_COLORS_KEY]: { newValue: "language" } }, "local");
  expect(published).toEqual(["single"]);
  changes.emit({ [LANGUAGE_COLORS_KEY]: {} }, "sync");
  expect(published).toEqual(["single", "language"]);
  unsubscribe();
  expect(changes.listeners.size).toBe(0);
  changes.emit({ [LANGUAGE_COLORS_KEY]: { newValue: "single" } }, "sync");
  expect(published).toEqual(["single", "language"]);
});

test("subscription publishes the stored mode and ignores a read finishing after cleanup", async () => {
  const published: LanguageColorMode[] = [];
  const changes = event<Listener>();
  subscribeLanguageColors((mode) => published.push(mode), {
    storage: memoryStorage({ [LANGUAGE_COLORS_KEY]: "single" }),
    changes,
  });
  await settle();
  expect(published).toEqual(["single"]);
  const reading = deferred<Record<string, unknown>>();
  const late: LanguageColorMode[] = [];
  subscribeLanguageColors((mode) => late.push(mode), {
    storage: { ...memoryStorage(), get: () => reading.promise },
    changes,
  })();
  reading.resolve({ [LANGUAGE_COLORS_KEY]: "single" });
  await settle();
  expect(late).toEqual([]);
});

test("applies the remembered mode at startup and follows live changes", async () => {
  const reading = deferred<Record<string, unknown>>();
  const changes = event<Listener>();
  const root = { dataset: {} as DOMStringMap };
  const storage = rememberedStorage();
  rememberLanguageColors("single", storage);
  const restore = [
    replaceGlobal("document", { documentElement: root }),
    replaceGlobal("localStorage", storage),
    replaceGlobal("chrome", {
      storage: { sync: { get: () => reading.promise }, onChanged: changes },
    }),
  ];
  try {
    followLanguageColors();
    expect(root.dataset).toEqual({ languageColors: "single" });
    reading.resolve({});
    await settle();
    expect(root.dataset).toEqual({});
    expect(storage.values.has(LANGUAGE_COLORS_KEY)).toBe(false);
    changes.emit({ [LANGUAGE_COLORS_KEY]: { newValue: "single" } }, "sync");
    expect(root.dataset).toEqual({ languageColors: "single" });
    expect(readRememberedLanguageColors(storage)).toBe("single");
  } finally {
    for (const reset of restore.reverse()) reset();
  }
});
