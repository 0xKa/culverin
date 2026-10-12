import { expect, test } from "bun:test";
import {
  followLanguageColors,
  languageColors,
  languageMarkers,
  type RootChoice,
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

const choices = [
  {
    choice: languageColors as RootChoice<string>,
    other: "single",
    attribute: "languageColors",
  },
  {
    choice: languageMarkers as RootChoice<string>,
    other: "circle",
    attribute: "languageMarker",
  },
];

test("defaults to language colors with square markers", () => {
  expect(languageColors.fallback).toBe("language");
  expect(languageColors.values).toEqual(["language", "single"]);
  expect(languageMarkers.fallback).toBe("square");
  expect(languageMarkers.values).toEqual(["square", "circle", "none"]);
});

test("saves each choice independently and removes defaults", async () => {
  const storage = memoryStorage({ [HIGH_CONTRAST_KEY]: true });
  expect(await languageColors.read(storage)).toBe("language");
  expect(await languageMarkers.read(storage)).toBe("square");
  await languageColors.write("single", storage);
  await languageMarkers.write("none", storage);
  expect(await languageColors.read(storage)).toBe("single");
  expect(await languageMarkers.read(storage)).toBe("none");
  await languageColors.write("language", storage);
  expect(await languageMarkers.read(storage)).toBe("none");
  expect(await highContrast.read(storage)).toBe(true);
  await languageMarkers.write("square", storage);
  expect(Object.fromEntries(storage.values)).toEqual({
    [HIGH_CONTRAST_KEY]: true,
  });
});

for (const { choice, other, attribute } of choices) {
  test(`${choice.key} falls back for invalid or unavailable synced storage`, async () => {
    for (const value of ["Square", "accent", true, 1, null, undefined]) {
      expect(await choice.read(memoryStorage({ [choice.key]: value }))).toBe(
        choice.fallback,
      );
    }
    expect(
      await choice.read({
        ...memoryStorage(),
        get: async () => {
          throw new Error("unavailable");
        },
      }),
    ).toBe(choice.fallback);
    expect(choice.parse(other)).toBe(other);
  });

  test(`${choice.key} is applied and remembered locally and tolerates unavailable storage`, () => {
    const storage = rememberedStorage();
    const root = { dataset: { theme: "dark" } as DOMStringMap };
    expect(choice.readRemembered(storage)).toBe(choice.fallback);
    choice.remember(other, storage);
    choice.apply(choice.readRemembered(storage), root);
    expect(root.dataset).toEqual({ theme: "dark", [attribute]: other });
    choice.remember(choice.fallback, storage);
    choice.apply(choice.readRemembered(storage), root);
    expect(root.dataset).toEqual({ theme: "dark" });
    expect(storage.values.has(choice.key)).toBe(false);
    storage.values.set(choice.key, "invalid");
    expect(choice.readRemembered(storage)).toBe(choice.fallback);
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
    expect(choice.readRemembered(broken)).toBe(choice.fallback);
    expect(() => choice.remember(other, broken)).not.toThrow();
  });

  test(`${choice.key} subscription keeps newer changes ahead of a stale read, ignores unrelated events, and cleans up`, async () => {
    const reading = deferred<Record<string, unknown>>();
    const changes = event<Listener>();
    const published: string[] = [];
    const unsubscribe = choice.subscribe((value) => published.push(value), {
      storage: { ...memoryStorage(), get: () => reading.promise },
      changes,
    });
    changes.emit({ [choice.key]: { newValue: other } }, "sync");
    reading.resolve({});
    await settle();
    expect(published).toEqual([other]);
    changes.emit({ [HIGH_CONTRAST_KEY]: { newValue: true } }, "sync");
    changes.emit({ [choice.key]: { newValue: choice.fallback } }, "local");
    expect(published).toEqual([other]);
    changes.emit({ [choice.key]: {} }, "sync");
    expect(published).toEqual([other, choice.fallback]);
    unsubscribe();
    expect(changes.listeners.size).toBe(0);
    changes.emit({ [choice.key]: { newValue: other } }, "sync");
    expect(published).toEqual([other, choice.fallback]);
  });

  test(`${choice.key} subscription publishes the stored value and ignores a read finishing after cleanup`, async () => {
    const published: string[] = [];
    const changes = event<Listener>();
    choice.subscribe((value) => published.push(value), {
      storage: memoryStorage({ [choice.key]: other }),
      changes,
    });
    await settle();
    expect(published).toEqual([other]);
    const reading = deferred<Record<string, unknown>>();
    const late: string[] = [];
    choice.subscribe((value) => late.push(value), {
      storage: { ...memoryStorage(), get: () => reading.promise },
      changes,
    })();
    reading.resolve({ [choice.key]: other });
    await settle();
    expect(late).toEqual([]);
  });
}

test("applies both remembered choices at startup and follows live changes", async () => {
  const reading = deferred<Record<string, unknown>>();
  const changes = event<Listener>();
  const root = { dataset: {} as DOMStringMap };
  const storage = rememberedStorage();
  languageColors.remember("single", storage);
  languageMarkers.remember("circle", storage);
  const restore = [
    replaceGlobal("document", { documentElement: root }),
    replaceGlobal("localStorage", storage),
    replaceGlobal("chrome", {
      storage: { sync: { get: () => reading.promise }, onChanged: changes },
    }),
  ];
  try {
    followLanguageColors();
    expect(root.dataset).toEqual({
      languageColors: "single",
      languageMarker: "circle",
    });
    reading.resolve({ [languageMarkers.key]: "circle" });
    await settle();
    expect(root.dataset).toEqual({ languageMarker: "circle" });
    expect(storage.values.has(languageColors.key)).toBe(false);
    changes.emit({ [languageMarkers.key]: { newValue: "none" } }, "sync");
    changes.emit({ [languageColors.key]: { newValue: "single" } }, "sync");
    expect(root.dataset).toEqual({
      languageColors: "single",
      languageMarker: "none",
    });
    expect(languageMarkers.readRemembered(storage)).toBe("none");
    changes.emit({ [languageMarkers.key]: {} }, "sync");
    expect(root.dataset).toEqual({ languageColors: "single" });
  } finally {
    for (const reset of restore.reverse()) reset();
  }
});
