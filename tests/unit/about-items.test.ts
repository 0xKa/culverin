import { expect, test } from "bun:test";
import {
  aboutLayout,
  defaultAboutLayout,
  moveItem,
  parseAboutLayout,
  shownItems,
  toggleItem,
  validShownItems,
} from "../../extension/src/repository-page/about-items";

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

test("parses stored layouts and keeps new items available", () => {
  expect(parseAboutLayout(undefined)).toBeUndefined();
  expect(parseAboutLayout(["lines"])).toBeUndefined();
  expect(parseAboutLayout({ order: "lines", hidden: [] })).toBeUndefined();
  expect(
    parseAboutLayout({
      order: ["size", "stars", "size"],
      hidden: ["files", "x"],
    }),
  ).toEqual({ order: ["size", "lines", "files"], hidden: ["files"] });
  expect(
    parseAboutLayout({ order: ["lines"], hidden: ["lines", "files", "size"] }),
  ).toEqual({ order: ["lines", "files", "size"], hidden: [] });
});

test("moves and toggles items while keeping one shown", () => {
  const moved = moveItem(defaultAboutLayout, "files", -1);
  expect(moved.order).toEqual(["files", "lines", "size"]);
  expect(moveItem(moved, "files", -1)).toBe(moved);
  expect(moveItem(moved, "size", 1)).toBe(moved);
  const hidden = toggleItem(toggleItem(moved, "size"), "lines");
  expect(hidden.hidden).toEqual(["lines", "size"]);
  expect(shownItems(hidden)).toEqual(["files"]);
  expect(toggleItem(hidden, "files")).toBe(hidden);
  expect(shownItems(toggleItem(hidden, "size"))).toEqual(["files", "size"]);
});

test("validates the items sent to the page", () => {
  expect(validShownItems(["size", "lines"])).toBe(true);
  expect(validShownItems([])).toBe(false);
  expect(validShownItems(["lines", "lines"])).toBe(false);
  expect(validShownItems(["lines", "stars"])).toBe(false);
});

test("stores the layout only when it differs from the default", async () => {
  const storage = memoryStorage();
  expect(await aboutLayout.read(storage)).toEqual(defaultAboutLayout);
  const custom = toggleItem(moveItem(defaultAboutLayout, "size", -1), "lines");
  await aboutLayout.write(custom, storage);
  expect(storage.values.get(aboutLayout.key)).toEqual(custom);
  expect(await aboutLayout.read(storage)).toEqual(custom);
  await aboutLayout.write(defaultAboutLayout, storage);
  expect(storage.values.has(aboutLayout.key)).toBe(false);
  const broken = {
    ...storage,
    get: async () => {
      throw new Error("unavailable");
    },
  };
  expect(await aboutLayout.read(broken)).toEqual(defaultAboutLayout);
  expect(
    await aboutLayout.read(memoryStorage({ [aboutLayout.key]: "bad" })),
  ).toEqual(defaultAboutLayout);
});
