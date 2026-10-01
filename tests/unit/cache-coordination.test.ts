import { describe, expect, test } from "bun:test";
import {
  cachedResultSummaries,
  PUBLIC_CACHE_KEY,
  PUBLIC_CACHE_BYTES,
  PRIVATE_CACHE_KEY,
  PrivateResultCache,
  privateCache,
  PublicResultCache,
  PUBLIC_RESOLUTION_TTL,
  ResolutionCache,
  RESOLUTION_KEY,
  RESOLUTION_TTL,
  resolutionIdentity,
  resultIdentity,
  type PublicStorage,
} from "../../extension/src/github/cache";
import {
  AnalysisCoordinator,
  QUEUED_JOBS,
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

async function result(id = "42"): Promise<AnalysisResultV2> {
  return {
    schemaVersion: 2,
    repository: { id },
    revision: { commitSha: sha },
    engine: {
      name: "tokei",
      version: "15.0.0",
      wrapperVersion: "3",
      rulesProfile: "source-v1",
      rulesVersion: "2",
      rulesHash: await effectiveRulesHash(defaultIgnore),
      coveragePolicyVersion: "2",
    },
    totals: { files: 0, lines: 0, code: 0, comments: 0, blanks: 0 },
    languages: [],
    otherFiles: { files: 0, lines: 0, extensions: [], moreExtensions: 0 },
    coverage: {
      regularFiles: 0,
      countedFiles: 0,
      analyzedBytes: 0,
      totalBytes: 0,
      skippedFiles: 0,
      skippedByReason: {
        excluded_by_rule: 0,
        unsupported_language: 0,
        binary_content: 0,
        oversized_source: 0,
        unsupported_notebook: 0,
      },
      complete: true,
      incompleteReasons: [],
    },
  };
}

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
  for (let index = 1; index <= 101; index++)
    await refs.resolve(`public:owner/repo-${index}`, async () => {
      calls++;
      return resolution(String(index));
    });
  await refs.resolve("public:owner/repo-1", async () => {
    calls++;
    return resolution("1");
  });
  expect(calls).toBe(102);
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
  now += 30_000;
  finishFirst(output);
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(started).toEqual(["1"]);
  expect(failed).toEqual(["2"]);
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
