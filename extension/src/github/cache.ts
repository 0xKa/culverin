import { validateResult, type AnalysisResultV2 } from "../counter/result";
import {
  coveragePolicyVersion,
  rulesProfile,
  rulesVersion,
  wrapperVersion,
} from "../counter/rules";
import { validEnvelope, type ResolutionEnvelope } from "./public-protocol";

export const PUBLIC_CACHE_KEY = "culverin.public-results.v1";
export const PUBLIC_CACHE_ENTRIES = 200;
export const PUBLIC_CACHE_BYTES = 5 * 1024 * 1024;
export const RESOLUTION_ENTRIES = 100;
export const RESOLUTION_BYTES = 512 * 1024;
export const RESOLUTION_TTL = 60_000;

type Entry = {
  identity: string;
  result: AnalysisResultV2;
  resolution: ResolutionEnvelope;
  storedAt: number;
  lastAccess: number;
  bytes: number;
};

type Snapshot = { version: 1; entries: Entry[] };

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
    "15.0.0",
    wrapperVersion,
    rulesProfile,
    rulesVersion,
    rulesHash,
    coveragePolicyVersion,
    2,
  ]);
}

function validEntry(value: unknown): value is Entry {
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
    value.resolution.visibility === "public" &&
    value.result.repository.id === value.resolution.repositoryId &&
    value.result.revision.commitSha === value.resolution.sha &&
    value.identity === resultIdentity(value.result) &&
    value.bytes === bytes({ ...value, bytes: 0 })
  );
}

function size(snapshot: Snapshot): number {
  return bytes({ [PUBLIC_CACHE_KEY]: snapshot });
}

function lru(a: Entry, b: Entry): number {
  return (
    a.lastAccess - b.lastAccess ||
    (a.identity < b.identity ? -1 : a.identity > b.identity ? 1 : 0)
  );
}

export class PublicResultCache {
  private snapshot: Snapshot | undefined;
  private tail: Promise<void> = Promise.resolve();
  private revoked = new Set<string>();

  constructor(
    private readonly storage: PublicStorage,
    private readonly now: () => number = Date.now,
  ) {}

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
    const value = (await this.storage.get(PUBLIC_CACHE_KEY))[PUBLIC_CACHE_KEY];
    const snapshot: Snapshot = { version: 1, entries: [] };
    let dirty = value !== undefined;
    if (
      record(value) &&
      exact(value, ["version", "entries"]) &&
      value.version === 1 &&
      Array.isArray(value.entries) &&
      value.entries.length <= PUBLIC_CACHE_ENTRIES &&
      size(value as Snapshot) <= PUBLIC_CACHE_BYTES
    ) {
      const seen = new Set<string>();
      for (const entry of value.entries) {
        if (!validEntry(entry) || seen.has(entry.identity)) continue;
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
      snapshot.entries.length > PUBLIC_CACHE_ENTRIES ||
      size(snapshot) > PUBLIC_CACHE_BYTES
    )
      snapshot.entries.shift();
    let retriedQuota = false;
    for (;;) {
      try {
        await this.storage.set({ [PUBLIC_CACHE_KEY]: snapshot });
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
        actual = await this.storage.getBytesInUse(PUBLIC_CACHE_KEY);
      } catch {
        this.snapshot = undefined;
        return false;
      }
      if (actual <= PUBLIC_CACHE_BYTES) return true;
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
      if (resolution.visibility !== "public" || !validEnvelope(resolution))
        return undefined;
      if (this.revoked.has(resolution.repositoryId)) return undefined;
      const identity = resolutionIdentity(resolution, rulesHash);
      const snapshot = await this.load();
      const entry = snapshot.entries.find((item) => item.identity === identity);
      if (!entry) return undefined;
      if (!validEntry(entry)) {
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
        resolution.visibility !== "public" ||
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
        resolution.visibility !== "public" ||
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
        await this.storage.remove(PUBLIC_CACHE_KEY);
        this.snapshot = { version: 1, entries: [] };
        return;
      }
      snapshot.entries = snapshot.entries.filter(
        (entry) => entry.result.repository.id !== repositoryId,
      );
      if (!(await this.persist(snapshot))) {
        await this.storage.remove(PUBLIC_CACHE_KEY);
        this.snapshot = { version: 1, entries: [] };
      }
    });
  }

  async clear(): Promise<void> {
    return this.serial(async () => {
      this.revoked.clear();
      this.snapshot = { version: 1, entries: [] };
      if (!(await this.persist(this.snapshot)))
        await this.storage.remove(PUBLIC_CACHE_KEY);
    });
  }

  allowRepository(resolution: ResolutionEnvelope): void {
    if (resolution.visibility === "public")
      this.revoked.delete(resolution.repositoryId);
  }

  isRevoked(repositoryId: string): boolean {
    return this.revoked.has(repositoryId);
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

export class ResolutionCache {
  private entries: RefEntry[] = [];
  private inflight = new Map<string, Promise<ResolvedReference>>();
  private epoch = 0;

  constructor(private readonly now: () => number = Date.now) {}

  async resolve(
    key: string,
    fetcher: () => Promise<ResolutionEnvelope>,
  ): Promise<ResolutionEnvelope> {
    return (await this.resolveWithStatus(key, fetcher)).envelope;
  }

  async resolveWithStatus(
    key: string,
    fetcher: () => Promise<ResolutionEnvelope>,
  ): Promise<ResolvedReference> {
    const now = this.now();
    this.entries = this.entries.filter(
      (entry) => now - entry.envelope.resolvedAt < RESOLUTION_TTL,
    );
    const hit = this.entries.find((entry) => entry.key === key);
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

  invalidateRepository(repositoryId: string): void {
    this.epoch++;
    this.entries = this.entries.filter(
      (entry) => entry.envelope.repositoryId !== repositoryId,
    );
  }

  clear(): void {
    this.epoch++;
    this.entries = [];
  }
}
