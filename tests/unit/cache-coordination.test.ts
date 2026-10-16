import { result } from "./support/result";
import { describe, expect, test } from "bun:test";
import {
  ACCESS_REFRESH,
  cachedResultSummaries,
  PUBLIC_CACHE_KEY,
  PUBLIC_CACHE_BYTES,
  PRIVATE_CACHE_KEY,
  PrivateResultCache,
  privateCache,
  publicCache,
  PublicResultCache,
  PUBLIC_RESOLUTION_TTL,
  ResolutionCache,
  RESOLUTION_ENTRIES,
  RESOLUTION_KEY,
  RESOLUTION_TTL,
  resolutionIdentity,
  resultIdentity,
  type PublicStorage,
} from "../../extension/src/github/cache";
import {
  AnalysisCoordinator,
  QUEUED_JOBS,
  QUEUE_WAIT_MS,
  SUBSCRIPTIONS,
  type AnalysisOutput,
  type Subscriber,
} from "../../extension/src/github/coordinator";
import {
  defaultIgnore,
  effectiveRulesHash,
} from "../../extension/src/counter/rules";
import type { AnalysisResultV2 } from "../../extension/src/counter/result";
import type { ResolutionEnvelope } from "../../extension/src/github/public-protocol";

const sha = "a".repeat(40);
const resolution = (id = "42", name = "repo"): ResolutionEnvelope => ({
  repositoryId: id,
  owner: "owner",
  name,
  defaultBranch: "main",
  visibility: "public",
  sha,
  sizeKb: 2048,
  resolvedAt: Date.now(),
});

class MemoryStorage implements PublicStorage {
  values: Record<string, unknown> = {};
  failWrites = 0;
  overhead = 0;
  async get(key: string): Promise<Record<string, unknown>> {
    return { [key]: this.values[key] };
  }
  async set(items: Record<string, unknown>): Promise<void> {
    if (this.failWrites-- > 0) throw new Error("quota");
    Object.assign(this.values, structuredClone(items));
  }
  async remove(key: string): Promise<void> {
    delete this.values[key];
  }
  async getBytesInUse(key: string): Promise<number> {
    return (
      this.overhead +
      new TextEncoder().encode(JSON.stringify({ [key]: this.values[key] }))
        .byteLength
    );
  }
}

test.each(["public", "private"] as const)(
  "preserves fresh and legacy oversized file details in the %s cache",
  async (visibility) => {
    const storage = new MemoryStorage();
    const cache =
      visibility === "public"
        ? new PublicResultCache(storage)
        : new PrivateResultCache(storage);
    const envelope = { ...resolution(), visibility };
    const value = await result();
    value.coverage = {
      ...value.coverage,
      regularFiles: 1,
      totalBytes: 9_000_000,
      skippedFiles: 1,
      skippedByReason: {
        ...value.coverage.skippedByReason,
        oversized_source: 1,
      },
      complete: false,
      incompleteReasons: ["oversized_source"],
      oversizedFiles: [{ path: "src/large.rs", bytes: 9_000_000 }],
    };
    await cache.put(envelope, value);
    const reopen = () =>
      visibility === "public"
        ? new PublicResultCache(storage)
        : new PrivateResultCache(storage);
    expect(await reopen().get(envelope, value.engine.rulesHash)).toEqual(value);
    delete value.coverage.oversizedFiles;
    await cache.put(envelope, value);
    expect(await reopen().get(envelope, value.engine.rulesHash)).toEqual(value);
  },
);

describe("private result cache", () => {
  const privateResolution = (id = "42", name = "repo"): ResolutionEnvelope => ({
    ...resolution(id, name),
    visibility: "private",
  });

  test("keeps private results apart from public ones", async () => {
    const storage = new MemoryStorage();
    const publicResults = new PublicResultCache(storage);
    const privateResults = new PrivateResultCache(storage);
    await publicResults.put(privateResolution(), await result());
    expect(storage.values[PUBLIC_CACHE_KEY]).toBeUndefined();
    await privateResults.put(resolution(), await result());
    expect(storage.values[PRIVATE_CACHE_KEY]).toBeUndefined();
    await privateResults.put(privateResolution(), await result());
    expect(
      await privateResults.get(
        privateResolution(),
        (await result()).engine.rulesHash,
      ),
    ).toBeDefined();
    expect(
      await publicResults.get(resolution(), (await result()).engine.rulesHash),
    ).toBeUndefined();
    expect(storage.values[PUBLIC_CACHE_KEY]).toBeUndefined();
    const listed = cachedResultSummaries(
      storage.values[PRIVATE_CACHE_KEY],
      privateCache,
    );
    expect(listed.map((entry) => entry.name)).toEqual(["repo"]);
    expect(cachedResultSummaries(storage.values[PRIVATE_CACHE_KEY])).toEqual(
      [],
    );
  });

  test("forgets a repository by name when access is lost", async () => {
    const storage = new MemoryStorage();
    const cache = new PrivateResultCache(storage);
    const hash = (await result()).engine.rulesHash;
    await cache.put(privateResolution("42", "repo"), await result("42"));
    await cache.put(privateResolution("43", "other"), await result("43"));
    await cache.purgeName({ owner: "OWNER", name: "Repo" });
    expect(
      await cache.hasRepository({ owner: "owner", name: "repo" }, hash),
    ).toBe(false);
    expect(
      await cache.get(privateResolution("42", "repo"), hash),
    ).toBeUndefined();
    expect(
      await cache.hasRepository({ owner: "owner", name: "other" }, hash),
    ).toBe(true);
    await cache.put(privateResolution("42", "repo"), await result("42"));
    expect(
      await cache.get(privateResolution("42", "repo"), hash),
    ).toBeUndefined();
    cache.allowRepository(privateResolution("42", "repo"));
    await cache.put(privateResolution("42", "repo"), await result("42"));
    expect(
      await cache.get(privateResolution("42", "repo"), hash),
    ).toBeDefined();
  });
});

test.each(["public", "private"] as const)(
  "deletes one %s result by identity and still accepts it again",
  async (visibility) => {
    const storage = new MemoryStorage();
    const cache =
      visibility === "public"
        ? new PublicResultCache(storage)
        : new PrivateResultCache(storage);
    const options = visibility === "public" ? publicCache : privateCache;
    const key = visibility === "public" ? PUBLIC_CACHE_KEY : PRIVATE_CACHE_KEY;
    const envelope = (id: string, name: string): ResolutionEnvelope => ({
      ...resolution(id, name),
      visibility,
    });
    const hash = (await result()).engine.rulesHash;
    await cache.put(envelope("42", "repo"), await result("42"));
    await cache.put(envelope("43", "other"), await result("43"));
    const target = cachedResultSummaries(storage.values[key], options).find(
      (entry) => entry.name === "repo",
    )!;
    await cache.delete("unknown");
    expect(cachedResultSummaries(storage.values[key], options)).toHaveLength(2);
    await cache.delete(target.identity);
    expect(
      cachedResultSummaries(storage.values[key], options).map(
        (entry) => entry.name,
      ),
    ).toEqual(["other"]);
    expect(await cache.get(envelope("42", "repo"), hash)).toBeUndefined();
    expect(await cache.get(envelope("43", "other"), hash)).toBeDefined();
    await cache.put(envelope("42", "repo"), await result("42"));
    expect(await cache.get(envelope("42", "repo"), hash)).toBeDefined();
  },
);

test.each(["public", "private"] as const)(
  "a failed %s result deletion reports the failure and keeps every result",
  async (visibility) => {
    const storage = new MemoryStorage();
    const cache =
      visibility === "public"
        ? new PublicResultCache(storage)
        : new PrivateResultCache(storage);
    const options = visibility === "public" ? publicCache : privateCache;
    const key = visibility === "public" ? PUBLIC_CACHE_KEY : PRIVATE_CACHE_KEY;
    const envelope = (id: string, name: string): ResolutionEnvelope => ({
      ...resolution(id, name),
      visibility,
    });
    const hash = (await result()).engine.rulesHash;
    const names = () =>
      cachedResultSummaries(storage.values[key], options)
        .map((entry) => entry.name)
        .sort();
    await cache.put(envelope("41", "first"), await result("41"));
    await cache.put(envelope("42", "repo"), await result("42"));
    await cache.put(envelope("43", "other"), await result("43"));
    const target = cachedResultSummaries(storage.values[key], options).find(
      (entry) => entry.name === "repo",
    )!;
    for (const failures of [1, Number.POSITIVE_INFINITY]) {
      storage.failWrites = failures;
      await expect(cache.delete(target.identity)).rejects.toThrow("quota");
      storage.failWrites = 0;
      expect(names()).toEqual(["first", "other", "repo"]);
    }
    for (const [id, name] of [
      ["41", "first"],
      ["42", "repo"],
      ["43", "other"],
    ] as const)
      expect(await cache.get(envelope(id, name), hash)).toBeDefined();
    await cache.delete(target.identity);
    expect(names()).toEqual(["first", "other"]);
  },
);

describe("public result cache", () => {
  test("lists valid stored results for display, most recently viewed first", async () => {
    let now = 1_000;
    const storage = new MemoryStorage();
    const cache = new PublicResultCache(storage, () => now);
    await cache.put(resolution("42", "repo"), await result("42"));
    now = 2_000;
    await cache.put(resolution("43", "other"), await result("43"));
    const stored = storage.values[PUBLIC_CACHE_KEY] as {
      version: 1;
      entries: unknown[];
    };
    const listed = cachedResultSummaries({
      ...stored,
      entries: [...stored.entries, { identity: "forged" }],
    });
    expect(listed.map((entry) => [entry.name, entry.storedAt])).toEqual([
      ["other", 2_000],
      ["repo", 1_000],
    ]);
    expect(listed[0]).toMatchObject({
      owner: "owner",
      sha,
      codeLines: 0,
      files: 0,
      topLanguage: undefined,
    });
    expect(listed[0]!.bytes).toBeGreaterThan(0);
    expect(cachedResultSummaries(undefined)).toEqual([]);
    expect(cachedResultSummaries({ version: 2, entries: [] })).toEqual([]);
  });

  test("writes cache hits only for label changes or stale access times", async () => {
    let now = 1_000;
    const storage = new MemoryStorage();
    let writes = 0;
    const set = storage.set.bind(storage);
    storage.set = async (items) => {
      writes++;
      await set(items);
    };
    const cache = new PublicResultCache(storage, () => now);
    const hash = await effectiveRulesHash(defaultIgnore);
    const stored = () =>
      cachedResultSummaries(storage.values[PUBLIC_CACHE_KEY])[0]!;
    await cache.put(resolution(), await result());
    writes = 0;
    for (let index = 0; index < 10; index++) {
      now += 1_000;
      expect(
        await cache.get({ ...resolution(), resolvedAt: now }, hash),
      ).toBeDefined();
    }
    expect(writes).toBe(0);
    expect(stored().lastAccess).toBe(1_000);
    now += 1_000;
    expect(await cache.get(resolution("42", "renamed"), hash)).toBeDefined();
    expect(writes).toBe(1);
    expect(stored()).toMatchObject({ name: "renamed", lastAccess: now });
    const renamed = now;
    now += ACCESS_REFRESH - 1;
    await cache.get(resolution("42", "renamed"), hash);
    expect(writes).toBe(1);
    now += 1;
    await cache.get(resolution("42", "renamed"), hash);
    expect(writes).toBe(2);
    expect(stored().lastAccess).toBe(renamed + ACCESS_REFRESH);
    const reopened = new PublicResultCache(storage, () => now);
    expect(await reopened.get(resolution("42", "renamed"), hash)).toBeDefined();
    await reopened.delete(stored().identity);
    expect(writes).toBe(3);
    expect(cachedResultSummaries(storage.values[PUBLIC_CACHE_KEY])).toEqual([]);
  });

  test("finds cached results by repository name under the same rules", async () => {
    const cache = new PublicResultCache(new MemoryStorage());
    const hash = await effectiveRulesHash(defaultIgnore);
    expect(
      await cache.hasRepository({ owner: "owner", name: "repo" }, hash),
    ).toBe(false);
    await cache.put(resolution(), await result());
    expect(
      await cache.hasRepository({ owner: "OWNER", name: "Repo" }, hash),
    ).toBe(true);
    expect(
      await cache.hasRepository({ owner: "owner", name: "other" }, hash),
    ).toBe(false);
    expect(
      await cache.hasRepository(
        { owner: "owner", name: "repo" },
        "c".repeat(64),
      ),
    ).toBe(false);
    await cache.purgeRepository("42");
    expect(
      await cache.hasRepository({ owner: "owner", name: "repo" }, hash),
    ).toBe(false);
  });

  test("reuses stable ID and SHA through rename, but invalidates semantic changes", async () => {
    const storage = new MemoryStorage();
    const cache = new PublicResultCache(storage);
    const value = await result();
    await cache.put(resolution(), value);
    expect(
      await cache.get(
        resolution("42", "renamed"),
        await effectiveRulesHash(defaultIgnore),
      ),
    ).toEqual(value);
    expect(
      await cache.get(
        resolution("43"),
        await effectiveRulesHash(defaultIgnore),
      ),
    ).toBeUndefined();
    expect(
      await cache.get(
        { ...resolution(), sha: "b".repeat(40) },
        await effectiveRulesHash(defaultIgnore),
      ),
    ).toBeUndefined();
    expect(resultIdentity(value)).toBe(
      resolutionIdentity(resolution(), await effectiveRulesHash(defaultIgnore)),
    );
    for (const field of [
      "version",
      "wrapperVersion",
      "rulesProfile",
      "rulesVersion",
      "rulesHash",
      "coveragePolicyVersion",
    ] as const) {
      const changed = structuredClone(value);
      Object.assign(changed.engine, { [field]: "changed" });
      expect(resultIdentity(changed)).not.toBe(resultIdentity(value));
    }
    expect(resultIdentity({ ...value, schemaVersion: 3 as 2 })).not.toBe(
      resultIdentity(value),
    );
    await cache.purgeRepository("42");
    expect(
      await cache.get(resolution(), await effectiveRulesHash(defaultIgnore)),
    ).toBeUndefined();
    expect(cache.isRevoked("42")).toBe(true);
    await cache.put(resolution(), value);
    expect(
      await cache.get(resolution(), await effectiveRulesHash(defaultIgnore)),
    ).toBeUndefined();
    cache.allowRepository(resolution());
    await cache.put(resolution(), value);
    expect(
      await cache.get(resolution(), await effectiveRulesHash(defaultIgnore)),
    ).toEqual(value);
  });

  test("keeps partial results, rejects corrupted ones, and clears only its namespace", async () => {
    const storage = new MemoryStorage();
    storage.values.other = "keep";
    const cache = new PublicResultCache(storage);
    const value = await result();
    const partial: AnalysisResultV2 = {
      ...value,
      coverage: {
        ...value.coverage,
        regularFiles: 1,
        totalBytes: 9_000_000,
        skippedFiles: 1,
        skippedByReason: {
          ...value.coverage.skippedByReason,
          oversized_source: 1,
        },
        complete: false,
        incompleteReasons: ["oversized_source"],
      },
    };
    await cache.put(resolution(), partial);
    expect(
      await cache.get(resolution(), await effectiveRulesHash(defaultIgnore)),
    ).toEqual(partial);
    await cache.put(resolution(), {
      ...value,
      coverage: { ...value.coverage, complete: false },
    });
    expect(
      await cache.get(resolution(), await effectiveRulesHash(defaultIgnore)),
    ).toEqual(partial);
    await cache.put(resolution(), value);
    const snapshot = storage.values[PUBLIC_CACHE_KEY] as {
      entries: { result: AnalysisResultV2 }[];
    };
    snapshot.entries[0]!.result.revision.commitSha = "b".repeat(40);
    expect(
      await new PublicResultCache(storage).get(
        resolution(),
        await effectiveRulesHash(defaultIgnore),
      ),
    ).toBeUndefined();
    expect(
      (storage.values[PUBLIC_CACHE_KEY] as { entries: unknown[] }).entries,
    ).toEqual([]);
    await cache.clear();
    expect(storage.values.other).toBe("keep");
  });

  test("drops stored results that predate snapshot file sizes", async () => {
    const storage = new MemoryStorage();
    await new PublicResultCache(storage).put(resolution(), await result());
    const snapshot = storage.values[PUBLIC_CACHE_KEY] as {
      entries: { identity: string; result: Record<string, unknown> }[];
    };
    const entry = snapshot.entries[0]!;
    const coverage = { ...(entry.result.coverage as Record<string, unknown>) };
    delete coverage.totalBytes;
    entry.result = { ...entry.result, schemaVersion: 1, coverage };
    entry.identity = entry.identity.replace(/2\]$/, "1]");
    expect(
      await new PublicResultCache(storage).get(
        resolution(),
        await effectiveRulesHash(defaultIgnore),
      ),
    ).toBeUndefined();
    expect(
      (storage.values[PUBLIC_CACHE_KEY] as { entries: unknown[] }).entries,
    ).toEqual([]);
  });

  test("keeps results per ignore rules and reports results under other rules", async () => {
    const storage = new MemoryStorage();
    const cache = new PublicResultCache(storage);
    const custom = { disabledGroups: [], exclusions: ["docs/"] };
    const customHash = await effectiveRulesHash(custom);
    const defaultHash = await effectiveRulesHash(defaultIgnore);
    const value = await result();
    await cache.put(resolution(), value);
    expect(await cache.get(resolution(), customHash)).toBeUndefined();
    expect(await cache.hasOtherRules(resolution(), customHash)).toBe(true);
    expect(await cache.hasOtherRules(resolution(), defaultHash)).toBe(false);
    const customValue = structuredClone(value);
    customValue.engine.rulesHash = customHash;
    await cache.put(resolution(), customValue);
    expect(await cache.get(resolution(), customHash)).toEqual(customValue);
    expect(await cache.get(resolution(), defaultHash)).toEqual(value);
    expect(
      await cache.hasOtherRules(
        { ...resolution(), sha: "b".repeat(40) },
        customHash,
      ),
    ).toBe(false);
  });

  test("evicts by entry budget and survives a quota failure", async () => {
    const storage = new MemoryStorage();
    const cache = new PublicResultCache(storage);
    for (let index = 1; index <= 201; index++)
      await cache.put(resolution(String(index)), await result(String(index)));
    const snapshot = storage.values[PUBLIC_CACHE_KEY] as {
      entries: unknown[];
    };
    expect(snapshot.entries.length).toBe(200);
    expect(
      await cache.get(resolution("1"), await effectiveRulesHash(defaultIgnore)),
    ).toBeUndefined();
    expect(
      await cache.get(
        resolution("201"),
        await effectiveRulesHash(defaultIgnore),
      ),
    ).toBeDefined();
    storage.failWrites = 1;
    await cache.put(resolution("202"), await result("202"));
    expect(
      await cache.get(
        resolution("202"),
        await effectiveRulesHash(defaultIgnore),
      ),
    ).toBeDefined();
  });

  test("enforces byte budget using actual storage accounting", async () => {
    const storage = new MemoryStorage();
    const cache = new PublicResultCache(storage);
    const large = async (id: string) => {
      const value = await result(id);
      value.languages = [
        {
          language: "x".repeat(3 * 1024 * 1024),
          files: 0,
          lines: 0,
          code: 0,
          comments: 0,
          blanks: 0,
        },
      ];
      return value;
    };
    await cache.put(resolution("1"), await large("1"));
    await cache.put(resolution("2"), await large("2"));
    expect(
      await cache.get(resolution("1"), await effectiveRulesHash(defaultIgnore)),
    ).toBeUndefined();
    expect(
      await cache.get(resolution("2"), await effectiveRulesHash(defaultIgnore)),
    ).toBeDefined();
    storage.overhead = 3 * 1024 * 1024;
    await cache.put(resolution("3"), await large("3"));
    expect(await storage.getBytesInUse(PUBLIC_CACHE_KEY)).toBeLessThanOrEqual(
      PUBLIC_CACHE_BYTES,
    );
    expect(
      await cache.get(resolution("3"), await effectiveRulesHash(defaultIgnore)),
    ).toBeUndefined();
  });

  test("serializes concurrent writes", async () => {
    const storage = new MemoryStorage();
    const cache = new PublicResultCache(storage);
    await Promise.all(
      Array.from({ length: 20 }, async (_, index) =>
        cache.put(
          resolution(String(index + 1)),
          await result(String(index + 1)),
        ),
      ),
    );
    const snapshot = storage.values[PUBLIC_CACHE_KEY] as { entries: unknown[] };
    expect(snapshot.entries.length).toBe(20);
  });

  test("purge removes the cache namespace when storage rejects a rewrite", async () => {
    const storage = new MemoryStorage();
    const cache = new PublicResultCache(storage);
    await cache.put(resolution(), await result());
    storage.failWrites = 2;
    await cache.purgeRepository("42");
    expect(storage.values[PUBLIC_CACHE_KEY]).toBeUndefined();
    expect(storage.values.other).toBeUndefined();
  });
});

test("resolution cache coalesces, expires at 60 seconds, and purges by ID", async () => {
  let now = Date.now();
  const refs = new ResolutionCache(() => now);
  let calls = 0;
  const fetcher = async () => {
    calls++;
    return { ...resolution(), resolvedAt: now };
  };
  await Promise.all([
    refs.resolve("public:owner/repo", fetcher),
    refs.resolve("public:owner/repo", fetcher),
  ]);
  expect(calls).toBe(1);
  now += RESOLUTION_TTL - 1;
  await refs.resolve("public:owner/repo", fetcher);
  expect(calls).toBe(1);
  now++;
  await refs.resolve("public:owner/repo", fetcher);
  expect(calls).toBe(2);
  await refs.invalidateRepository("42");
  await refs.resolve("public:owner/repo", fetcher);
  expect(calls).toBe(3);
  const reused = await refs.resolveWithStatus("public:owner/repo", fetcher);
  expect(reused.fresh).toBe(false);
  await refs.invalidateRepository("42");
  const renewed = await refs.resolveWithStatus("public:owner/repo", fetcher);
  expect(renewed.fresh).toBe(true);
  expect(refs.isCurrent(renewed.epoch)).toBe(true);
});

test("dropping public resolutions keeps private ones and their epoch", async () => {
  const refs = new ResolutionCache();
  await refs.resolve("anonymous:owner/repo", async () => resolution("42"));
  const kept = await refs.resolveWithStatus("token:owner/repo", async () => ({
    ...resolution("42"),
    visibility: "private",
  }));
  await refs.invalidateRepository("42", "public");
  expect(refs.isCurrent(kept.epoch)).toBe(false);
  expect(await refs.peek("anonymous:owner/repo")).toBeUndefined();
  expect((await refs.peek("token:owner/repo"))?.envelope.visibility).toBe(
    "private",
  );
  const current = await refs.resolveWithStatus("token:owner/repo", async () =>
    resolution("42"),
  );
  await refs.invalidateRepository("42", "public");
  expect(refs.isCurrent(current.epoch)).toBe(true);
});

test("public resolutions persist for 20 minutes across worker restarts", async () => {
  let now = Date.now();
  const storage = new MemoryStorage();
  let calls = 0;
  const fetcher = async () => {
    calls++;
    return { ...resolution(), resolvedAt: now };
  };
  const first = new ResolutionCache(() => now, PUBLIC_RESOLUTION_TTL, storage);
  await first.resolve("public:owner/repo", fetcher);
  await Promise.resolve();
  expect(storage.values[RESOLUTION_KEY]).toHaveLength(1);
  now += PUBLIC_RESOLUTION_TTL - 1;
  const restarted = new ResolutionCache(
    () => now,
    PUBLIC_RESOLUTION_TTL,
    storage,
  );
  expect((await restarted.peek("public:owner/repo"))?.envelope.sha).toBe(sha);
  expect(await restarted.peek("public:owner/other")).toBeUndefined();
  const reused = await restarted.resolveWithStatus(
    "public:owner/repo",
    fetcher,
  );
  expect([reused.fresh, calls]).toEqual([false, 1]);
  const forced = await restarted.resolveWithStatus(
    "public:owner/repo",
    fetcher,
    true,
  );
  expect([forced.fresh, calls]).toEqual([true, 2]);
  now += PUBLIC_RESOLUTION_TTL;
  expect(await restarted.peek("public:owner/repo")).toBeUndefined();
  await restarted.resolve("public:owner/repo", fetcher);
  expect(calls).toBe(3);
  await restarted.invalidateRepository("42");
  await Promise.resolve();
  expect(storage.values[RESOLUTION_KEY]).toBeUndefined();
});

test("clearing resolutions ignores a load that was still pending", async () => {
  const storage = new MemoryStorage();
  const stored = () => [
    { key: "public:owner/repo", envelope: resolution(), lastAccess: 1 },
  ];
  storage.values[RESOLUTION_KEY] = stored();
  let release = () => undefined as void;
  const refs = new ResolutionCache(Date.now, PUBLIC_RESOLUTION_TTL, {
    get: async (key) => {
      await new Promise<void>((resolve) => (release = resolve));
      return storage.get(key);
    },
    set: (items) => storage.set(items),
    remove: (key) => storage.remove(key),
  });
  const pending = refs.peek("public:owner/repo");
  await refs.clear();
  release();
  expect(await pending).toBeUndefined();
  expect(storage.values[RESOLUTION_KEY]).toBeUndefined();
  storage.values[RESOLUTION_KEY] = [
    ...stored(),
    { key: "public:owner/bad", envelope: { sha }, lastAccess: 1 },
  ];
  const restarted = new ResolutionCache(
    Date.now,
    PUBLIC_RESOLUTION_TTL,
    storage,
  );
  expect(await restarted.peek("public:owner/repo")).toBeDefined();
  expect(await restarted.peek("public:owner/bad")).toBeUndefined();
});

test("resolution cache evicts the oldest entry at its entry limit", async () => {
  const refs = new ResolutionCache();
  let calls = 0;
  for (let index = 1; index <= RESOLUTION_ENTRIES + 1; index++)
    await refs.resolve(`public:owner/repo-${index}`, async () => {
      calls++;
      return resolution(String(index));
    });
  await refs.resolve("public:owner/repo-1", async () => {
    calls++;
    return resolution("1");
  });
  expect(calls).toBe(RESOLUTION_ENTRIES + 2);
});

test("resolution cache keeps one lookup under each of its aliases", async () => {
  const refs = new ResolutionCache();
  let calls = 0;
  const resolved = await refs.resolveWithStatus(
    "public:owner/repo@main/src",
    async () => {
      calls++;
      return resolution("1");
    },
    false,
    () => ["public:owner/repo@main", "public:owner/repo"],
  );
  expect(resolved.fresh).toBe(true);
  for (const key of [
    "public:owner/repo@main/src",
    "public:owner/repo@main",
    "public:owner/repo",
  ])
    expect((await refs.peek(key))?.envelope).toEqual(resolved.envelope);
  expect(await refs.peek("public:owner/repo@other")).toBeUndefined();
  expect(calls).toBe(1);
});

test("coordinator reports progress phases only forward", () => {
  let now = 0;
  let jobId = "";
  let progress: (
    phase: "downloading" | "decompressing" | "counting",
    processedBytes?: number,
  ) => void = () => undefined;
  const coordinator = new AnalysisCoordinator(
    (job, report) => {
      jobId = job.id;
      progress = report;
      return new Promise<AnalysisOutput>(() => undefined);
    },
    () => undefined,
    () => now,
  );
  const seen: string[] = [];
  coordinator.subscribe("same", resolution(), undefined, "", {
    requestId: crypto.randomUUID(),
    owner: "owner",
    public: true,
    onProgress: (phase, bytes) => {
      seen.push(bytes === undefined ? phase : `${phase}:${bytes}`);
    },
    onComplete: () => undefined,
    onFailure: () => undefined,
  });
  progress("downloading", 1);
  now = 100;
  progress("downloading", 2);
  now = 150;
  expect(coordinator.reportCounting(jobId)).toBe(true);
  now = 1000;
  progress("downloading", 3);
  progress("decompressing");
  now = 1100;
  coordinator.reportCounting(jobId);
  now = 1200;
  coordinator.reportCounting(jobId);
  expect(seen).toEqual(["downloading:1", "counting", "counting"]);
  expect(coordinator.reportCounting("other")).toBe(false);
});

test("coordinator shares jobs, bounds queued work, and scopes cancellation", async () => {
  const runs: {
    signal: AbortSignal;
    resolve: (output: AnalysisOutput) => void;
  }[] = [];
  const done: string[] = [];
  const coordinator = new AnalysisCoordinator(
    async (job) =>
      new Promise<AnalysisOutput>((resolve) => {
        runs.push({ signal: job.signal, resolve });
      }),
    () => undefined,
  );
  const value = await result();
  const output: AnalysisOutput = {
    result: value,
    transport: { compressedBytes: 1, decompressedBytes: 2 },
    wasmLinearMemoryBytes: 0,
  };
  const subscriber = (owner: string): Subscriber => ({
    requestId: crypto.randomUUID(),
    owner,
    public: true,
    onProgress: () => undefined,
    onComplete: () => {
      done.push(owner);
    },
    onFailure: () => undefined,
  });
  const first = subscriber("first");
  const second = subscriber("second");
  expect(
    coordinator.subscribe("same", resolution(), undefined, "", first),
  ).toBe(true);
  expect(
    coordinator.subscribe("same", resolution(), undefined, "", second),
  ).toBe(true);
  expect(runs.length).toBe(1);
  expect(coordinator.detach("other", first.requestId)).toBe(false);
  expect(coordinator.detach("first", first.requestId)).toBe(true);
  expect(runs[0]!.signal.aborted).toBe(false);
  for (let index = 0; index < QUEUED_JOBS; index++)
    expect(
      coordinator.subscribe(
        String(index),
        resolution(String(index + 1)),
        undefined,
        "",
        subscriber(String(index)),
      ),
    ).toBe(true);
  expect(
    coordinator.subscribe(
      "overflow",
      resolution("99"),
      undefined,
      "",
      subscriber("overflow"),
    ),
  ).toBe(false);
  expect(coordinator.subscriptionCount()).toBe(QUEUED_JOBS + 1);
  runs[0]!.resolve(output);
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(done).toEqual(["second"]);
  coordinator.abortAll("cancel");
  expect(coordinator.subscriptionCount()).toBeLessThan(SUBSCRIPTIONS);
});

test("coordinator runs jobs with the ignore rules they were requested with", async () => {
  const seen: unknown[] = [];
  const coordinator = new AnalysisCoordinator(
    (job) => {
      seen.push(job.ignore);
      return new Promise<AnalysisOutput>(() => undefined);
    },
    () => undefined,
  );
  const ignore = { disabledGroups: ["build" as const], exclusions: ["docs/"] };
  coordinator.subscribe(
    "custom",
    resolution(),
    undefined,
    "",
    {
      requestId: crypto.randomUUID(),
      owner: "a",
      public: true,
      onProgress: () => undefined,
      onComplete: () => undefined,
      onFailure: () => undefined,
    },
    25_000,
    ignore,
  );
  expect(seen).toEqual([ignore]);
  coordinator.detachOwner("a");
});

test("queued work expires before archive execution", async () => {
  let now = Date.now();
  let finishFirst: (output: AnalysisOutput) => void = () => undefined;
  const started: string[] = [];
  const failed: string[] = [];
  const output: AnalysisOutput = {
    result: await result(),
    transport: { compressedBytes: 0, decompressedBytes: 0 },
    wasmLinearMemoryBytes: 0,
  };
  const coordinator = new AnalysisCoordinator(
    (job) => {
      started.push(job.resolution.repositoryId);
      return new Promise((resolve) => {
        finishFirst = resolve;
      });
    },
    () => undefined,
    () => now,
  );
  const subscribe = (id: string) =>
    coordinator.subscribe(id, resolution(id), undefined, "", {
      requestId: crypto.randomUUID(),
      owner: id,
      public: true,
      onProgress: () => undefined,
      onComplete: () => undefined,
      onFailure: () => failed.push(id),
    });
  expect(subscribe("1")).toBe(true);
  expect(subscribe("2")).toBe(true);
  now += QUEUE_WAIT_MS;
  finishFirst(output);
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(started).toEqual(["1"]);
  expect(failed).toEqual(["2"]);
});

function queueHarness() {
  const started: string[] = [];
  const finishers: ((output: AnalysisOutput) => void)[] = [];
  const failed: { owner: string; error: string }[] = [];
  const coordinator = new AnalysisCoordinator(
    (job) => {
      started.push(job.resolution.repositoryId);
      return new Promise((resolve) => finishers.push(resolve));
    },
    () => undefined,
  );
  const subscribe = (id: string, automatic: boolean, owner = id) =>
    coordinator.subscribe(id, resolution(id), undefined, "", {
      requestId: crypto.randomUUID(),
      owner,
      public: true,
      automatic,
      onProgress: () => undefined,
      onComplete: () => undefined,
      onFailure: (error) =>
        failed.push({ owner, error: (error as Error).message }),
    });
  const finish = async () => {
    finishers.shift()!({
      result: await result(),
      transport: { compressedBytes: 0, decompressedBytes: 0 },
      wasmLinearMemoryBytes: 0,
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
  };
  return { coordinator, started, failed, subscribe, finish };
}

test("queued counts started by a click run before older automatic counts", async () => {
  const { coordinator, started, subscribe, finish } = queueHarness();
  expect(subscribe("1", true)).toBe(true);
  expect(subscribe("2", true)).toBe(true);
  expect(subscribe("3", true)).toBe(true);
  expect(subscribe("4", false)).toBe(true);
  expect(subscribe("3", false, "click")).toBe(true);
  await finish();
  expect(started).toEqual(["1", "3"]);
  await finish();
  expect(started).toEqual(["1", "3", "4"]);
  await finish();
  expect(started).toEqual(["1", "3", "4", "2"]);
  coordinator.abortAll("cancel");
});

test("a click evicts the oldest queued automatic count when the queue is full", () => {
  const { coordinator, failed, subscribe } = queueHarness();
  expect(subscribe("active", true)).toBe(true);
  for (let index = 0; index < QUEUED_JOBS; index++)
    expect(subscribe(String(index), true)).toBe(true);
  expect(subscribe("auto-overflow", true)).toBe(false);
  expect(subscribe("click", false)).toBe(true);
  expect(failed).toEqual([{ owner: "0", error: "analysis_canceled" }]);
  expect(coordinator.status("0")).toBe("idle");
  expect(coordinator.status("active")).toBe("running");
  expect(coordinator.status("click")).toBe("queued");
  for (let index = 1; index < QUEUED_JOBS; index++)
    expect(subscribe(`click-${index}`, false)).toBe(true);
  expect(subscribe("click-overflow", false)).toBe(false);
  expect(coordinator.status("active")).toBe("running");
  coordinator.abortAll("cancel");
});

test("a click joining an automatic count raises its limits without restarting it", () => {
  const mib = 1024 * 1024;
  const seen: { compressed: number; decompressed: number }[] = [];
  let limits: { compressed: number; decompressed: number } | undefined;
  let raised = 0;
  const coordinator = new AnalysisCoordinator(
    (job) => {
      limits = job.limits;
      seen.push({ ...job.limits });
      job.onLimitsRaised(() => raised++);
      return new Promise<AnalysisOutput>(() => undefined);
    },
    () => undefined,
  );
  const join = (owner: string, automatic: boolean, limit?: number) =>
    coordinator.subscribe("same", resolution(), undefined, "", {
      requestId: crypto.randomUUID(),
      owner,
      public: true,
      automatic,
      limit,
      onProgress: () => undefined,
      onComplete: () => undefined,
      onFailure: () => undefined,
    });
  expect(join("page", true)).toBe(true);
  expect(seen).toEqual([{ compressed: 256 * mib, decompressed: 2048 * mib }]);
  expect(join("other-page", true)).toBe(true);
  expect(raised).toBe(0);
  expect(join("click", false, 1024 * mib)).toBe(true);
  expect(limits).toEqual({ compressed: 1024 * mib, decompressed: 8192 * mib });
  expect(raised).toBe(1);
  expect(join("smaller", false, 512 * mib)).toBe(true);
  expect(limits?.compressed).toBe(1024 * mib);
  expect(raised).toBe(1);
  expect(seen).toHaveLength(1);
  coordinator.abortAll("cancel");
});

test("subscription cap prevents a thirty-third owner from joining", async () => {
  const coordinator = new AnalysisCoordinator(
    () => new Promise<AnalysisOutput>(() => undefined),
    () => undefined,
  );
  for (let index = 0; index < SUBSCRIPTIONS; index++)
    expect(
      coordinator.subscribe("same", resolution(), undefined, "", {
        requestId: crypto.randomUUID(),
        owner: String(index),
        public: true,
        onProgress: () => undefined,
        onComplete: () => undefined,
        onFailure: () => undefined,
      }),
    ).toBe(true);
  expect(
    coordinator.subscribe("same", resolution(), undefined, "", {
      requestId: crypto.randomUUID(),
      owner: "overflow",
      public: true,
      onProgress: () => undefined,
      onComplete: () => undefined,
      onFailure: () => undefined,
    }),
  ).toBe(false);
  coordinator.abortAll("cancel");
});

test("confirmed private visibility stops active public subscribers", async () => {
  let finish: (output: AnalysisOutput) => void = () => undefined;
  let signal: AbortSignal | undefined;
  const events: string[] = [];
  const coordinator = new AnalysisCoordinator(
    (job) => {
      signal = job.signal;
      return new Promise((resolve) => {
        finish = resolve;
      });
    },
    () => undefined,
  );
  const requestId = crypto.randomUUID();
  coordinator.subscribe("public", resolution(), undefined, "", {
    requestId,
    owner: "first",
    public: true,
    onProgress: () => undefined,
    onComplete: () => {
      events.push("completed");
    },
    onFailure: () => events.push("failed"),
  });
  coordinator.abortPublicRepository("42");
  expect(signal?.aborted).toBe(true);
  expect(coordinator.isSubscribed("first", requestId)).toBe(false);
  finish({
    result: await result(),
    transport: { compressedBytes: 0, decompressedBytes: 0 },
    wasmLinearMemoryBytes: 0,
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(events).toEqual(["failed"]);
});

test("saved results keep how long their count took, and older results still load", async () => {
  const storage = new MemoryStorage();
  const hash = await effectiveRulesHash(defaultIgnore);
  await new PublicResultCache(storage).put(
    resolution(),
    await result(),
    124_000,
  );
  expect(
    await new PublicResultCache(storage).getWithDuration(resolution(), hash),
  ).toMatchObject({ durationMs: 124_000 });
  const snapshot = storage.values[PUBLIC_CACHE_KEY] as {
    entries: Record<string, unknown>[];
  };
  const { durationMs, ...older } = snapshot.entries[0]!;
  expect(durationMs).toBe(124_000);
  older.bytes = new TextEncoder().encode(
    JSON.stringify({ ...older, bytes: 0 }),
  ).byteLength;
  storage.values[PUBLIC_CACHE_KEY] = { version: 1, entries: [older] };
  const legacy = await new PublicResultCache(storage).getWithDuration(
    resolution(),
    hash,
  );
  expect(legacy?.result).toBeDefined();
  expect(legacy).not.toHaveProperty("durationMs");
  expect(cachedResultSummaries(storage.values[PUBLIC_CACHE_KEY])).toHaveLength(
    1,
  );
  storage.values[PUBLIC_CACHE_KEY] = {
    version: 1,
    entries: [{ ...older, durationMs: -1 }],
  };
  expect(cachedResultSummaries(storage.values[PUBLIC_CACHE_KEY])).toEqual([]);
  const invalid = new PublicResultCache(new MemoryStorage());
  await invalid.put(resolution(), await result(), Number.NaN);
  expect(await invalid.getWithDuration(resolution(), hash)).not.toHaveProperty(
    "durationMs",
  );
});

test("subscribers learn when a job started and how long it took", async () => {
  let now = 10_000;
  let finish: (output: AnalysisOutput) => void = () => undefined;
  let progress: (phase: "downloading") => void = () => undefined;
  const coordinator = new AnalysisCoordinator(
    (_job, report) => {
      progress = report;
      return new Promise((resolve) => {
        finish = resolve;
      });
    },
    () => undefined,
    () => now,
  );
  const seen: (number | undefined)[] = [];
  let completed: AnalysisOutput | undefined;
  coordinator.subscribe("job", resolution(), undefined, "", {
    requestId: crypto.randomUUID(),
    owner: "page",
    public: true,
    onProgress: (_phase, _bytes, startedAt) => seen.push(startedAt),
    onComplete: (output) => {
      completed = output;
    },
    onFailure: () => undefined,
  });
  expect(coordinator.startedAt("page")).toBe(10_000);
  expect(coordinator.startedAt("other")).toBeUndefined();
  now = 12_000;
  progress("downloading");
  expect(seen).toEqual([10_000]);
  now = 134_000;
  finish({
    result: await result(),
    transport: { compressedBytes: 0, decompressedBytes: 0 },
    wasmLinearMemoryBytes: 0,
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(completed?.durationMs).toBe(124_000);
});
