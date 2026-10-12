import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { popupApiLimit } from "../../extension/src/popup/api-limit-display";
import { event, settle } from "./support/events";

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

test("hides the popup API meter by default and stores only the opt-in", async () => {
  const storage = memoryStorage();
  expect(popupApiLimit.key).toBe("culverin.popupApiLimit");
  expect(await popupApiLimit.read(storage)).toBe("hidden");
  for (const value of [true, "visible", null])
    expect(
      await popupApiLimit.read(memoryStorage({ [popupApiLimit.key]: value })),
    ).toBe("hidden");
  await popupApiLimit.write("shown", storage);
  expect(Object.fromEntries(storage.values)).toEqual({
    [popupApiLimit.key]: "shown",
  });
  await popupApiLimit.write("hidden", storage);
  expect(storage.values.size).toBe(0);
});

test("marks the root only while shown and follows live changes", async () => {
  const root = { dataset: {} as DOMStringMap };
  popupApiLimit.apply("shown", root);
  expect(root.dataset).toEqual({ apiLimit: "shown" });
  popupApiLimit.apply("hidden", root);
  expect(root.dataset).toEqual({});
  const changes =
    event<
      (
        changes: Record<string, chrome.storage.StorageChange>,
        area: string,
      ) => void
    >();
  const published: string[] = [];
  popupApiLimit.subscribe((value) => published.push(value), {
    storage: memoryStorage(),
    changes,
  });
  await settle();
  changes.emit({ [popupApiLimit.key]: { newValue: "shown" } }, "sync");
  changes.emit({ [popupApiLimit.key]: {} }, "sync");
  expect(published).toEqual(["hidden", "shown", "hidden"]);
});

test("the popup stylesheet hides the meter unless the root opts in", () => {
  const css = readFileSync(
    resolve(import.meta.dirname, "../../extension/src/ui/styles.css"),
    "utf8",
  );
  expect(css).toMatch(
    /:root:not\(\[data-api-limit="shown"\]\) #api-limit \{\s*display: none;\s*\}/,
  );
});
