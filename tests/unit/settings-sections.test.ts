import { expect, test } from "bun:test";
import {
  initialSection,
  parseSection,
  readSection,
  rememberSection,
  SECTION_KEY,
  sections,
} from "../../extension/src/settings/sections";

test("reads settings sections from fragments and stored values", () => {
  expect(parseSection("#storage")).toBe("storage");
  expect(parseSection("ignore")).toBe("ignore");
  expect(parseSection("")).toBeUndefined();
  expect(parseSection("#")).toBeUndefined();
  expect(parseSection("#Storage")).toBeUndefined();
  expect(parseSection(null)).toBeUndefined();
});

test("prefers the URL fragment, then the remembered section, then the first", () => {
  expect(sections[0].id).toBe("storage");
  expect(initialSection("#ignore", "storage")).toBe("ignore");
  expect(initialSection("", "ignore")).toBe("ignore");
  expect(initialSection("#unknown", "ignore")).toBe("ignore");
  expect(initialSection("", "removed")).toBe("storage");
  expect(initialSection("", null)).toBe("storage");
});

test("remembers the section and tolerates unavailable storage", () => {
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
  };
  expect(readSection(storage)).toBeNull();
  rememberSection("ignore", storage);
  expect(values.get(SECTION_KEY)).toBe("ignore");
  expect(readSection(storage)).toBe("ignore");
  const broken = {
    getItem: (): string | null => {
      throw new Error("unavailable");
    },
    setItem: () => {
      throw new Error("unavailable");
    },
  };
  expect(readSection(broken)).toBeNull();
  expect(() => rememberSection("storage", broken)).not.toThrow();
});
