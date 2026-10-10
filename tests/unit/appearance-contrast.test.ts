import { expect, test } from "bun:test";
import {
  applyHighContrast,
  followHighContrast,
  highContrast,
  HIGH_CONTRAST_KEY,
  readRememberedHighContrast,
  rememberHighContrast,
} from "../../extension/src/appearance/contrast";
import {
  applyTheme,
  theme,
  THEME_KEY,
} from "../../extension/src/appearance/theme";
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

test("saves high contrast independently of the theme and removes its default", async () => {
  const storage = memoryStorage({ [THEME_KEY]: "dark" });
  expect(await highContrast.read(storage)).toBe(false);
  await highContrast.write(true, storage);
  expect(await highContrast.read(storage)).toBe(true);
  await theme.write("light", storage);
  expect(await highContrast.read(storage)).toBe(true);
  await highContrast.write(false, storage);
  expect(Object.fromEntries(storage.values)).toEqual({ [THEME_KEY]: "light" });
});

test("uses standard contrast for invalid or unavailable synced storage", async () => {
  for (const value of [false, "true", "high", 1, null, undefined]) {
    expect(
      await highContrast.read(memoryStorage({ [HIGH_CONTRAST_KEY]: value })),
    ).toBe(false);
  }
  const storage = memoryStorage();
  expect(
    await highContrast.read({
      ...storage,
      get: async () => {
        throw new Error("unavailable");
      },
    }),
  ).toBe(false);
  await expect(
    highContrast.write(true, {
      ...storage,
      set: async () => {
        throw new Error("unavailable");
      },
    }),
  ).rejects.toThrow("unavailable");
});

test("remembers contrast locally without changing the theme and tolerates unavailable storage", () => {
  const storage = rememberedStorage();
  const root = { dataset: { theme: "dark" } as DOMStringMap };
  expect(readRememberedHighContrast(storage)).toBe(false);
  rememberHighContrast(true, storage);
  applyHighContrast(readRememberedHighContrast(storage), root);
  applyTheme("light", root);
  expect(root.dataset).toEqual({ theme: "light", contrast: "high" });
  rememberHighContrast(false, storage);
  applyHighContrast(readRememberedHighContrast(storage), root);
  expect(root.dataset).toEqual({ theme: "light" });
  expect(storage.values.has(HIGH_CONTRAST_KEY)).toBe(false);
  storage.values.set(HIGH_CONTRAST_KEY, "invalid");
  expect(readRememberedHighContrast(storage)).toBe(false);
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
  expect(readRememberedHighContrast(broken)).toBe(false);
  expect(() => rememberHighContrast(true, broken)).not.toThrow();
  expect(() => rememberHighContrast(false, broken)).not.toThrow();
});

test("applies remembered contrast immediately and keeps live changes ahead of a stale startup read", async () => {
  const reading = deferred<Record<string, unknown>>();
  const changed =
    event<(changes: Record<string, chrome.storage.StorageChange>) => void>();
  const root = { dataset: { theme: "dark" } as DOMStringMap };
  const storage = rememberedStorage();
  rememberHighContrast(true, storage);
  const restore = [
    replaceGlobal("document", { documentElement: root }),
    replaceGlobal("localStorage", storage),
    replaceGlobal("chrome", {
      storage: { sync: { get: () => reading.promise, onChanged: changed } },
    }),
  ];
  try {
    followHighContrast();
    expect(root.dataset).toEqual({ theme: "dark", contrast: "high" });
    changed.emit({ [HIGH_CONTRAST_KEY]: { newValue: false } });
    reading.resolve({ [HIGH_CONTRAST_KEY]: true });
    await settle();
    expect(root.dataset).toEqual({ theme: "dark" });
    expect(readRememberedHighContrast(storage)).toBe(false);
    changed.emit({ [HIGH_CONTRAST_KEY]: { newValue: true } });
    expect(root.dataset).toEqual({ theme: "dark", contrast: "high" });
    expect(readRememberedHighContrast(storage)).toBe(true);
    changed.emit({ [THEME_KEY]: { newValue: "light" } });
    expect(root.dataset.contrast).toBe("high");
    changed.emit({ [HIGH_CONTRAST_KEY]: { newValue: "invalid" } });
    expect(root.dataset).toEqual({ theme: "dark" });
    changed.emit({ [HIGH_CONTRAST_KEY]: { newValue: true } });
    changed.emit({ [HIGH_CONTRAST_KEY]: {} });
    expect(root.dataset).toEqual({ theme: "dark" });
    expect(storage.values.has(HIGH_CONTRAST_KEY)).toBe(false);
  } finally {
    for (const reset of restore.reverse()) reset();
  }
});
