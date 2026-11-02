import { expect, test } from "bun:test";
import {
  COUNT_TRIGGER_KEY,
  countTrigger,
} from "../../extension/src/counting/trigger";
import type { PreferenceStorage } from "../../extension/src/preferences/define";
import {
  DOWNLOAD_LIMIT_KEY,
  downloadLimit,
  readDownloadLimit,
} from "../../extension/src/counting/download-limit";
import {
  AUTO_COUNT_ENTRIES,
  AUTO_COUNT_KEY,
  autoCountClaims,
} from "../../extension/src/counting/claims";

function memory(values: Record<string, unknown> = {}): PreferenceStorage & {
  values: Record<string, unknown>;
} {
  return {
    values,
    async get(key) {
      return { [key]: values[key] };
    },
    async set(items) {
      Object.assign(values, items);
    },
    async remove(key) {
      delete values[key];
    },
  };
}

test("counts manually unless the page trigger is stored", async () => {
  expect(await countTrigger.read(memory())).toBe("manual");
  expect(await countTrigger.read(memory({ [COUNT_TRIGGER_KEY]: "open" }))).toBe(
    "open",
  );
  expect(
    await countTrigger.read(memory({ [COUNT_TRIGGER_KEY]: "always" })),
  ).toBe("manual");
  expect(
    await countTrigger.read({
      ...memory(),
      get: () => Promise.reject(new Error("unavailable")),
    }),
  ).toBe("manual");
});

test("stores only the non-default trigger", async () => {
  const storage = memory();
  await countTrigger.write("open", storage);
  expect(storage.values).toEqual({ [COUNT_TRIGGER_KEY]: "open" });
  await countTrigger.write("manual", storage);
  expect(storage.values).toEqual({});
});

test("claims each automatic count once and keeps the newest claims", async () => {
  const values: Record<string, unknown> = {};
  const claim = autoCountClaims({
    async get(key) {
      return { [key]: values[key] };
    },
    async set(items) {
      Object.assign(values, items);
    },
  });
  const [first, duplicate] = await Promise.all([claim("a"), claim("a")]);
  expect([first, duplicate]).toEqual([true, false]);
  expect(await claim("b")).toBe(true);
  for (let index = 0; index < AUTO_COUNT_ENTRIES; index++)
    await claim(`fill-${index}`);
  expect((values[AUTO_COUNT_KEY] as string[]).length).toBe(AUTO_COUNT_ENTRIES);
  expect(await claim("a")).toBe(true);
});

test("does not claim when session storage fails", async () => {
  const claim = autoCountClaims({
    get: () => Promise.reject(new Error("unavailable")),
    set: () => Promise.resolve(),
  });
  expect(await claim("a")).toBe(false);
});

test("reads the download limit in MiB and falls back to 512 MiB", async () => {
  expect(await readDownloadLimit(memory())).toBe(512 * 1024 * 1024);
  expect(await readDownloadLimit(memory({ [DOWNLOAD_LIMIT_KEY]: 4096 }))).toBe(
    4096 * 1024 * 1024,
  );
  for (const value of [300, "1024", 8192, 256 * 1024 * 1024])
    expect(
      await readDownloadLimit(memory({ [DOWNLOAD_LIMIT_KEY]: value })),
    ).toBe(512 * 1024 * 1024);
  expect(
    await readDownloadLimit({
      ...memory(),
      get: () => Promise.reject(new Error("unavailable")),
    }),
  ).toBe(512 * 1024 * 1024);
});

test("stores only a non-default download limit", async () => {
  const storage = memory();
  await downloadLimit.write(1024, storage);
  expect(storage.values).toEqual({ [DOWNLOAD_LIMIT_KEY]: 1024 });
  await downloadLimit.write(512, storage);
  expect(storage.values).toEqual({});
});
