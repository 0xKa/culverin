import { expect, test } from "bun:test";
import { accent, followAccent } from "../../extension/src/appearance/accent";
import { HIGH_CONTRAST_KEY } from "../../extension/src/appearance/contrast";
import { deferred, event, settle } from "./support/events";
import {
  contrast,
  css,
  luminance,
  oklch,
  themeModes,
  variable,
} from "./support/theme-css";

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

test("defaults to blue and offers the curated accents", () => {
  expect(accent.key).toBe("culverin.accent");
  expect(accent.fallback).toBe("blue");
  expect(accent.values).toEqual([
    "blue",
    "indigo",
    "violet",
    "pink",
    "teal",
    "slate",
  ]);
});

test("saves a chosen accent, removes the default, and rejects unknown values", async () => {
  const storage = memoryStorage({ [HIGH_CONTRAST_KEY]: true });
  expect(await accent.read(storage)).toBe("blue");
  await accent.write("violet", storage);
  expect(await accent.read(storage)).toBe("violet");
  await accent.write("blue", storage);
  expect(Object.fromEntries(storage.values)).toEqual({
    [HIGH_CONTRAST_KEY]: true,
  });
  for (const value of ["Violet", "red", "#ff0000", true, 1, null]) {
    expect(await accent.read(memoryStorage({ [accent.key]: value }))).toBe(
      "blue",
    );
  }
});

test("applies the remembered accent at startup and follows live changes", async () => {
  const reading = deferred<Record<string, unknown>>();
  const changes = event<Listener>();
  const root = { dataset: { theme: "dark" } as DOMStringMap };
  const storage = rememberedStorage();
  accent.remember("teal", storage);
  const restore = [
    replaceGlobal("document", { documentElement: root }),
    replaceGlobal("localStorage", storage),
    replaceGlobal("chrome", {
      storage: { sync: { get: () => reading.promise }, onChanged: changes },
    }),
  ];
  try {
    followAccent();
    expect(root.dataset).toEqual({ theme: "dark", accent: "teal" });
    reading.resolve({ [accent.key]: "pink" });
    await settle();
    expect(root.dataset).toEqual({ theme: "dark", accent: "pink" });
    expect(accent.readRemembered(storage)).toBe("pink");
    changes.emit({ [accent.key]: {} }, "sync");
    expect(root.dataset).toEqual({ theme: "dark" });
    expect(storage.values.has(accent.key)).toBe(false);
  } finally {
    for (const reset of restore.reverse()) reset();
  }
});

function preset(value: string): { h: number; c: number } {
  const rule = new RegExp(`\\[data-accent="${value}"\\]\\s*\\{([^}]*)\\}`).exec(
    css,
  );
  if (!rule) throw new Error(`missing accent ${value}`);
  return {
    h: Number(variable([rule[1]!], "--accent-h")),
    c: Number(variable([rule[1]!], "--accent-c")),
  };
}

function color(
  blocks: string[],
  name: string,
  { h, c }: { h: number; c: number },
) {
  const value = variable(blocks, name)
    .replace(/calc\(([\d.]+) \* var\(--accent-c\)\)/g, (_, x) => `${x * c}`)
    .replace(/calc\(var\(--accent-h\) - ([\d.]+)\)/g, (_, x) => `${h - x}`)
    .replace(/var\(--accent-h\)/g, `${h}`);
  return luminance(oklch(value));
}

test("the default accent keeps the original blue", () => {
  expect(preset("blue")).toEqual({ h: 255, c: 1 });
  expect(css).toMatch(/:root,\s*\[data-accent="blue"\]\s*\{/);
});

test("every accent keeps text, buttons, and focus rings readable in every theme and contrast mode", () => {
  const failures: string[] = [];
  for (const value of accent.values) {
    const hue = preset(value);
    for (const [mode, blocks] of Object.entries(themeModes)) {
      const shade = (name: string) => color(blocks, name, hue);
      const canvas = shade("--color-canvas");
      const raised = shade("--color-raised");
      const pairs: [string, number, number, number][] = [
        ["text on canvas", shade("--color-accent-text"), canvas, 4.5],
        ["text on raised", shade("--color-accent-text"), raised, 4.5],
        [
          "text on soft",
          shade("--color-accent-text"),
          shade("--color-accent-soft"),
          4.5,
        ],
        [
          "ink on accent",
          shade("--color-accent-ink"),
          shade("--color-accent"),
          4.5,
        ],
        [
          "ink on hover",
          shade("--color-accent-ink"),
          shade("--color-accent-hover"),
          4.5,
        ],
        ["accent on canvas", shade("--color-accent"), canvas, 3],
      ];
      for (const [pair, first, second, minimum] of pairs) {
        const ratio = contrast(first, second);
        if (ratio < minimum)
          failures.push(`${value} ${mode} ${pair} ${ratio.toFixed(2)}`);
      }
    }
  }
  expect(failures).toEqual([]);
});
