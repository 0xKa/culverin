import { expect, test } from "bun:test";
import {
  applyTheme,
  parseTheme,
  readRememberedTheme,
  rememberTheme,
  theme,
  THEME_KEY,
} from "../../extension/src/appearance/theme";

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

test("reads known themes and falls back to the system theme", async () => {
  expect(parseTheme("dark")).toBe("dark");
  expect(parseTheme("Dark")).toBeUndefined();
  expect(parseTheme(undefined)).toBeUndefined();
  expect(await theme.read(memoryStorage())).toBe("system");
  expect(await theme.read(memoryStorage({ [THEME_KEY]: "light" }))).toBe(
    "light",
  );
  expect(await theme.read(memoryStorage({ [THEME_KEY]: "sepia" }))).toBe(
    "system",
  );
  expect(
    await theme.read({
      ...memoryStorage(),
      get: () => Promise.reject(new Error("unavailable")),
    }),
  ).toBe("system");
});

test("stores only a theme other than the system theme", async () => {
  const storage = memoryStorage();
  await theme.write("dark", storage);
  expect(Object.fromEntries(storage.values)).toEqual({ [THEME_KEY]: "dark" });
  await theme.write("system", storage);
  expect(storage.values.size).toBe(0);
});

test("marks the root only for a chosen theme", () => {
  const root = { dataset: {} as DOMStringMap };
  applyTheme("dark", root);
  expect(root.dataset.theme).toBe("dark");
  applyTheme("light", root);
  expect(root.dataset.theme).toBe("light");
  applyTheme("system", root);
  expect("theme" in root.dataset).toBe(false);
});

test("remembers the theme locally and tolerates unavailable storage", () => {
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
    removeItem: (key: string) => void values.delete(key),
  };
  expect(readRememberedTheme(storage)).toBe("system");
  rememberTheme("dark", storage);
  expect(values.get(THEME_KEY)).toBe("dark");
  expect(readRememberedTheme(storage)).toBe("dark");
  values.set(THEME_KEY, "sepia");
  expect(readRememberedTheme(storage)).toBe("system");
  rememberTheme("system", storage);
  expect(values.has(THEME_KEY)).toBe(false);
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
  expect(readRememberedTheme(broken)).toBe("system");
  expect(() => rememberTheme("dark", broken)).not.toThrow();
});
