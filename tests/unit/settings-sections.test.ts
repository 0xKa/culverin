import { expect, test } from "bun:test";
import {
  fixedLimits,
  sizeLabel,
} from "../../extension/src/settings/large-repositories";
import {
  initialSection,
  sectionGroups,
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
  expect(sections[0].id).toBe("appearance");
  expect(initialSection("#ignore", "storage")).toBe("ignore");
  expect(initialSection("", "ignore")).toBe("ignore");
  expect(initialSection("#unknown", "ignore")).toBe("ignore");
  expect(initialSection("", "removed")).toBe("appearance");
  expect(initialSection("", null)).toBe("appearance");
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

test("groups Large repositories under Counting after Ignored files", () => {
  expect(
    sectionGroups
      .find((group) => group.name === "Counting")
      ?.sections.map((section) => section.id),
  ).toEqual(["counting", "ignore", "large-repositories"]);
  expect(parseSection("#large-repositories")).toBe("large-repositories");
});

test("describes download sizes and the fixed limits from the constants", () => {
  expect([256, 512, 1024, 2048, 4096].map(sizeLabel)).toEqual([
    "256 MiB",
    "512 MiB",
    "1 GiB",
    "2 GiB",
    "4 GiB",
  ]);
  expect(fixedLimits).toEqual([
    { label: "Unpacked size", value: "8 times the download limit" },
    { label: "Archive entries", value: "2,000,000" },
    { label: "Files", value: "1,000,000" },
    {
      label: "Source files over 8 MiB",
      value: "Skipped, and the total is marked partial",
    },
    { label: "Time per count", value: "60 minutes" },
  ]);
});
