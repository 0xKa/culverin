import { validateResult, type AnalysisResultV2 } from "../counter/result";
import {
  coveragePolicyVersion,
  engineVersion,
  rulesProfile,
  rulesVersion,
  wrapperVersion,
} from "../counter/rules";
import { validEnvelope, type ResolutionEnvelope } from "./public-protocol";

export const PUBLIC_CACHE_KEY = "culverin.public-results.v1";
export const PUBLIC_CACHE_ENTRIES = 200;
export const PUBLIC_CACHE_BYTES = 5 * 1024 * 1024;
export const PRIVATE_CACHE_KEY = "culverin.private-results.v1";
export const PRIVATE_CACHE_ENTRIES = 100;
export const PRIVATE_CACHE_BYTES = 2 * 1024 * 1024;
export const RESOLUTION_ENTRIES = 100;
export const RESOLUTION_BYTES = 512 * 1024;
export const RESOLUTION_TTL = 60_000;
export const PUBLIC_RESOLUTION_TTL = 20 * 60_000;
export const RESOLUTION_KEY = "github.resolutions";

type Entry = {
  identity: string;
  result: AnalysisResultV2;
  resolution: ResolutionEnvelope;
  storedAt: number;
  lastAccess: number;
  bytes: number;
};

type Snapshot = { version: 1; entries: Entry[] };

export type Visibility = ResolutionEnvelope["visibility"];

export type CacheOptions = {
  key: string;
  visibility: Visibility;
  entries: number;
  bytes: number;
};

export const publicCache: CacheOptions = {
  key: PUBLIC_CACHE_KEY,
  visibility: "public",
  entries: PUBLIC_CACHE_ENTRIES,
  bytes: PUBLIC_CACHE_BYTES,
};

export const privateCache: CacheOptions = {
  key: PRIVATE_CACHE_KEY,
  visibility: "private",
  entries: PRIVATE_CACHE_ENTRIES,
  bytes: PRIVATE_CACHE_BYTES,
};

export type PublicStorage = {
  get(key: string): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(key: string): Promise<void>;
  getBytesInUse(key: string): Promise<number>;
};

const encoder = new TextEncoder();
const bytes = (value: unknown): number =>
  encoder.encode(JSON.stringify(value)).byteLength;
const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const exact = (value: Record<string, unknown>, keys: string[]) =>
  Object.keys(value).sort().join("|") === keys.sort().join("|");
const validTime = (value: unknown): value is number =>
  Number.isSafeInteger(value) && (value as number) > 0;

export function resultIdentity(result: AnalysisResultV2): string {
  return JSON.stringify([
    result.repository.id,
    result.revision.commitSha,
    result.engine.name,
    result.engine.version,
    result.engine.wrapperVersion,
    result.engine.rulesProfile,
    result.engine.rulesVersion,
    result.engine.rulesHash,
    result.engine.coveragePolicyVersion,
    result.schemaVersion,
  ]);
}

export function resolutionIdentity(
  resolution: ResolutionEnvelope,
  rulesHash: string,
): string {
  return JSON.stringify([
    resolution.repositoryId,
    resolution.sha,
    "tokei",
    engineVersion,
    wrapperVersion,
    rulesProfile,
    rulesVersion,
    rulesHash,
    coveragePolicyVersion,
    2,
  ]);
}

function validEntry(value: unknown, visibility: Visibility): value is Entry {
  if (
    !record(value) ||
    !exact(value, [
      "identity",
      "result",
      "resolution",
      "storedAt",
      "lastAccess",
      "bytes",
    ]) ||
    typeof value.identity !== "string" ||
    !validTime(value.storedAt) ||
    !validTime(value.lastAccess) ||
    !Number.isSafeInteger(value.bytes) ||
    (value.bytes as number) <= 0 ||
    !validEnvelope(value.resolution) ||
    !validateResult(value.result) ||
    !value.result.coverage.complete
  )
    return false;
  return (
    value.resolution.visibility === visibility &&
    value.result.repository.id === value.resolution.repositoryId &&
    value.result.revision.commitSha === value.resolution.sha &&
    value.identity === resultIdentity(value.result) &&
    value.bytes === bytes({ ...value, bytes: 0 })
  );
}

export type CachedResultSummary = {
  identity: string;
  owner: string;
  name: string;
  sha: string;
  codeLines: number;
  files: number;
  topLanguage?: string;
  rulesHash: string;
  storedAt: number;
  lastAccess: number;
  bytes: number;
};

export function cachedResultSummaries(
  value: unknown,
  options: CacheOptions = publicCache,
): CachedResultSummary[] {
  if (
    !record(value) ||
    value.version !== 1 ||
    !Array.isArray(value.entries) ||
    value.entries.length > options.entries
  )
    return [];
  return value.entries
    .filter((entry): entry is Entry => validEntry(entry, options.visibility))
    .map((entry) => ({
      identity: entry.identity,
      owner: entry.resolution.owner,
      name: entry.resolution.name,
      sha: entry.result.revision.commitSha,
      codeLines: entry.result.totals.code,
      files: entry.result.totals.files,
      topLanguage: entry.result.languages.reduce<
        AnalysisResultV2["languages"][number] | undefined
      >((top, row) => (!top || row.code > top.code ? row : top), undefined)
        ?.language,
      rulesHash: entry.result.engine.rulesHash,
      storedAt: entry.storedAt,
      lastAccess: entry.lastAccess,
      bytes: entry.bytes,
    }))
    .sort((a, b) => b.lastAccess - a.lastAccess);
}

function lru(a: Entry, b: Entry): number {
  return (
    a.lastAccess - b.lastAccess ||
    (a.identity < b.identity ? -1 : a.identity > b.identity ? 1 : 0)
  );
}

export class ResultCache {
  private snapshot: Snapshot | undefined;
  private tail: Promise<void> = Promise.resolve();
  private revoked = new Set<string>();

  constructor(
    private readonly storage: PublicStorage,
    private readonly options: CacheOptions,
    private readonly now: () => number = Date.now,
  ) {}

  private size(snapshot: Snapshot): number {
    return bytes({ [this.options.key]: snapshot });
  }

  private valid(value: unknown): value is Entry {
    return validEntry(value, this.options.visibility);
  }

  private serial<T>(operation: () => Promise<T>): Promise<T> {
    const task = this.tail.then(operation, operation);
    this.tail = task.then(
      () => undefined,
      () => undefined,
    );
    return task;
  }

  private async load(): Promise<Snapshot> {
    if (this.snapshot) return this.snapshot;
    const value = (await this.storage.get(this.options.key))[this.options.key];
    const snapshot: Snapshot = { version: 1, entries: [] };
    let dirty = value !== undefined;
    if (
      record(value) &&
      exact(value, ["version", "entries"]) &&
      value.version === 1 &&
      Array.isArray(value.entries) &&
      value.entries.length <= this.options.entries &&
      this.size(value as Snapshot) <= this.options.bytes
    ) {
      const seen = new Set<string>();
      for (const entry of value.entries) {
        if (!this.valid(entry) || seen.has(entry.identity)) continue;
        seen.add(entry.identity);
        snapshot.entries.push(entry);
      }
      dirty = snapshot.entries.length !== value.entries.length;
    }
    this.snapshot = snapshot;
    if (dirty) await this.persist(snapshot);
    return snapshot;
  }

  private async persist(snapshot: Snapshot): Promise<boolean> {
    snapshot.entries.sort(lru);
    while (
      snapshot.entries.length > this.options.entries ||
      this.size(snapshot) > this.options.bytes
    )
      snapshot.entries.shift();
    let retriedQuota = false;
    for (;;) {
      try {
        await this.storage.set({ [this.options.key]: snapshot });
      } catch {
        if (!snapshot.entries.length || retriedQuota) {
          this.snapshot = undefined;
          return false;
        }
        snapshot.entries.shift();
        retriedQuota = true;
        continue;
      }
      let actual: number;
      try {
        actual = await this.storage.getBytesInUse(this.options.key);
      } catch {
        this.snapshot = undefined;
        return false;
      }
      if (actual <= this.options.bytes) return true;
      if (!snapshot.entries.length) {
        this.snapshot = undefined;
        return false;
      }
      snapshot.entries.shift();
    }
  }

  async get(
    resolution: ResolutionEnvelope,
    rulesHash: string,
  ): Promise<AnalysisResultV2 | undefined> {
    return this.serial(async () => {
      if (
        resolution.visibility !== this.options.visibility ||
        !validEnvelope(resolution)
      )
        return undefined;
      if (this.revoked.has(resolution.repositoryId)) return undefined;
      const identity = resolutionIdentity(resolution, rulesHash);
      const snapshot = await this.load();
      const entry = snapshot.entries.find((item) => item.identity === identity);
      if (!entry) return undefined;
      if (!this.valid(entry)) {
        snapshot.entries = snapshot.entries.filter((item) => item !== entry);
        await this.persist(snapshot);
        return undefined;
      }
      entry.resolution = resolution;
      entry.lastAccess = this.now();
      entry.bytes = bytes({ ...entry, bytes: 0 });
      await this.persist(snapshot);
      return entry.result;
    });
  }

  async put(
    resolution: ResolutionEnvelope,
    result: AnalysisResultV2,
  ): Promise<void> {
    return this.serial(async () => {
      if (
        !validEnvelope(resolution) ||
        resolution.visibility !== this.options.visibility ||
        !validateResult(result) ||
        !result.coverage.complete ||
        resultIdentity(result) !==
          resolutionIdentity(resolution, result.engine.rulesHash) ||
        this.revoked.has(resolution.repositoryId)
      )
        return;
      const snapshot = await this.load();
      const identity = resultIdentity(result);
      snapshot.entries = snapshot.entries.filter(
        (item) => item.identity !== identity,
      );
      const entry: Entry = {
        identity,
        result,
        resolution,
        storedAt: this.now(),
        lastAccess: this.now(),
        bytes: 0,
      };
      entry.bytes = bytes(entry);
      snapshot.entries.push(entry);
      await this.persist(snapshot);
    });
  }

  async hasOtherRules(
    resolution: ResolutionEnvelope,
    rulesHash: string,
  ): Promise<boolean> {
    return this.serial(async () => {
      if (
        resolution.visibility !== this.options.visibility ||
        this.revoked.has(resolution.repositoryId)
      )
        return false;
      return (await this.load()).entries.some(
        (entry) =>
          entry.result.repository.id === resolution.repositoryId &&
          entry.result.revision.commitSha === resolution.sha &&
          entry.result.engine.rulesHash !== rulesHash,
      );
    });
  }

  async hasRepository(
    repository: { owner: string; name: string },
    rulesHash: string,
  ): Promise<boolean> {
    const owner = repository.owner.toLowerCase();
    const name = repository.name.toLowerCase();
    return this.serial(async () =>
      (await this.load()).entries.some(
        (entry) =>
          !this.revoked.has(entry.resolution.repositoryId) &&
          entry.resolution.owner.toLowerCase() === owner &&
          entry.resolution.name.toLowerCase() === name &&
          entry.result.engine.rulesHash === rulesHash,
      ),
    );
  }

  async purgeRepository(repositoryId: string): Promise<void> {
    return this.serial(async () => {
      this.revoked.add(repositoryId);
      let snapshot: Snapshot;
      try {
        snapshot = await this.load();
      } catch {
        await this.storage.remove(this.options.key);
        this.snapshot = { version: 1, entries: [] };
        return;
      }
      snapshot.entries = snapshot.entries.filter(
        (entry) => entry.result.repository.id !== repositoryId,
      );
      if (!(await this.persist(snapshot))) {
        await this.storage.remove(this.options.key);
        this.snapshot = { version: 1, entries: [] };
      }
    });
  }

  async clear(): Promise<void> {
    return this.serial(async () => {
      this.revoked.clear();
      this.snapshot = { version: 1, entries: [] };
      if (!(await this.persist(this.snapshot)))
        await this.storage.remove(this.options.key);
    });
  }

  async purgeName(repository: { owner: string; name: string }): Promise<void> {
    const owner = repository.owner.toLowerCase();
    const name = repository.name.toLowerCase();
    return this.serial(async () => {
      const snapshot = await this.load();
      const kept = snapshot.entries.filter(
        (entry) =>
          entry.resolution.owner.toLowerCase() !== owner ||
          entry.resolution.name.toLowerCase() !== name,
      );
      if (kept.length === snapshot.entries.length) return;
      for (const entry of snapshot.entries)
        if (!kept.includes(entry))
          this.revoked.add(entry.resolution.repositoryId);
      snapshot.entries = kept;
      if (!(await this.persist(snapshot))) {
        await this.storage.remove(this.options.key);
        this.snapshot = { version: 1, entries: [] };
      }
    });
  }

  allowRepository(resolution: ResolutionEnvelope): void {
    if (resolution.visibility === this.options.visibility)
      this.revoked.delete(resolution.repositoryId);
  }

  isRevoked(repositoryId: string): boolean {
    return this.revoked.has(repositoryId);
  }
}

export class PublicResultCache extends ResultCache {
  constructor(storage: PublicStorage, now: () => number = Date.now) {
    super(storage, publicCache, now);
  }
}

export class PrivateResultCache extends ResultCache {
  constructor(storage: PublicStorage, now: () => number = Date.now) {
    super(storage, privateCache, now);
  }
}

type RefEntry = {
  key: string;
  envelope: ResolutionEnvelope;
  lastAccess: number;
};

type ResolvedReference = {
  envelope: ResolutionEnvelope;
  fresh: boolean;
  epoch: number;
};

export type ResolutionStore = {
  get(key: string): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(key: string): Promise<void>;
};

function validRefEntry(value: unknown): value is RefEntry {
  return (
    record(value) &&
    exact(value, ["key", "envelope", "lastAccess"]) &&
    typeof value.key === "string" &&
    value.key.length <= 512 &&
    validEnvelope(value.envelope) &&
    validTime(value.lastAccess)
  );
}

export class ResolutionCache {
  private entries: RefEntry[] = [];
  private inflight = new Map<string, Promise<ResolvedReference>>();
  private epoch = 0;
  private loaded: Promise<void> | undefined;
  private clears = 0;
  private writes: Promise<void> = Promise.resolve();

  constructor(
    private readonly now: () => number = Date.now,
    private readonly ttl = RESOLUTION_TTL,
    private readonly store?: ResolutionStore,
  ) {}

  private load(): Promise<void> {
    if (!this.store) return Promise.resolve();
    const clears = this.clears;
    this.loaded ??= this.store
      .get(RESOLUTION_KEY)
      .then((state) => {
        const value = state[RESOLUTION_KEY];
        if (clears !== this.clears || !Array.isArray(value)) return;
        const keys = new Set(this.entries.map((entry) => entry.key));
        this.entries = [
          ...value
            .filter(validRefEntry)
            .filter((entry) => !keys.has(entry.key)),
          ...this.entries,
        ];
        this.bound();
      })
      .catch(() => undefined);
    return this.loaded;
  }

  private persist(): void {
    const store = this.store;
    if (!store) return;
    const entries = this.entries.slice();
    this.writes = this.writes
      .then(() =>
        entries.length
          ? store.set({ [RESOLUTION_KEY]: entries })
          : store.remove(RESOLUTION_KEY),
      )
      .catch(() => undefined);
  }

  private bound(): void {
    const now = this.now();
    this.entries = this.entries.filter(
      (entry) => now - entry.envelope.resolvedAt < this.ttl,
    );
    this.entries.sort(
      (a, b) =>
        a.lastAccess - b.lastAccess ||
        (a.key < b.key ? -1 : a.key > b.key ? 1 : 0),
    );
    while (
      this.entries.length > RESOLUTION_ENTRIES ||
      bytes(this.entries) > RESOLUTION_BYTES
    )
      this.entries.shift();
  }

  async resolve(
    key: string,
    fetcher: () => Promise<ResolutionEnvelope>,
  ): Promise<ResolutionEnvelope> {
    return (await this.resolveWithStatus(key, fetcher)).envelope;
  }

  async peek(key: string): Promise<ResolvedReference | undefined> {
    await this.load();
    const now = this.now();
    const hit = this.entries.find(
      (entry) =>
        entry.key === key && now - entry.envelope.resolvedAt < this.ttl,
    );
    return hit && { envelope: hit.envelope, fresh: false, epoch: this.epoch };
  }

  async resolveWithStatus(
    key: string,
    fetcher: () => Promise<ResolutionEnvelope>,
    force = false,
  ): Promise<ResolvedReference> {
    await this.load();
    const now = this.now();
    this.entries = this.entries.filter(
      (entry) => now - entry.envelope.resolvedAt < this.ttl,
    );
    const hit = force
      ? undefined
      : this.entries.find((entry) => entry.key === key);
    if (hit) {
      hit.lastAccess = now;
      return { envelope: hit.envelope, fresh: false, epoch: this.epoch };
    }
    const existing = this.inflight.get(key);
    if (existing) return existing;
    if (this.inflight.size >= 32) throw new Error("analysis_busy");
    const epoch = this.epoch;
    const task = fetcher().then((envelope) => {
      if (epoch !== this.epoch) throw new Error("analysis_interrupted");
      if (validEnvelope(envelope)) {
        this.entries = this.entries.filter((entry) => entry.key !== key);
        this.entries.push({ key, envelope, lastAccess: this.now() });
        this.bound();
        this.persist();
      }
      return { envelope, fresh: true, epoch };
    });
    this.inflight.set(key, task);
    try {
      return await task;
    } finally {
      this.inflight.delete(key);
    }
  }

  isCurrent(epoch: number): boolean {
    return epoch === this.epoch;
  }

  async invalidateRepository(repositoryId: string): Promise<void> {
    this.epoch++;
    await this.load();
    this.entries = this.entries.filter(
      (entry) => entry.envelope.repositoryId !== repositoryId,
    );
    this.persist();
  }

  async clear(): Promise<void> {
    this.epoch++;
    this.clears++;
    this.loaded = Promise.resolve();
    this.entries = [];
    this.persist();
    await this.writes;
  }
}
