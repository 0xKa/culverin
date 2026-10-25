import type { AnalysisResultV2 } from "../counter/result";
import { defaultIgnore, type IgnoreSettings } from "../counter/rules";
import type { ResolutionEnvelope } from "./public-protocol";
import {
  ARCHIVE_TIMEOUTS,
  DOWNLOAD_LIMITS,
  jobLimits,
  type JobLimits,
} from "../archive/limits";

export const QUEUED_JOBS = 8;
export const QUEUE_WAIT_MS = ARCHIVE_TIMEOUTS.queue;
export const SUBSCRIPTIONS = 32;
export const PROGRESS_INTERVAL_MS = 250;

type ProgressPhase = "downloading" | "decompressing" | "counting";
const phaseOrder: ProgressPhase[] = [
  "downloading",
  "decompressing",
  "counting",
];

export type AnalysisOutput = {
  result: AnalysisResultV2;
  transport: {
    compressedBytes: number;
    decompressedBytes: number;
  };
  wasmLinearMemoryBytes: number;
  durationMs?: number;
};

export type Subscriber = {
  requestId: string;
  owner: string;
  public: boolean;
  automatic?: boolean;
  limit?: number;
  onProgress: (
    phase: "queued" | "downloading" | "decompressing" | "counting",
    processedBytes?: number,
    startedAt?: number,
  ) => void;
  onComplete: (
    output: AnalysisOutput,
    resolution: ResolutionEnvelope,
  ) => Promise<void> | void;
  onFailure: (error: unknown, signal: AbortSignal) => void;
};

type Job = {
  identity: string;
  resolution: ResolutionEnvelope;
  token?: string;
  generation: string;
  ignore: IgnoreSettings;
  limits: JobLimits;
  raised: Set<() => void>;
  id: string;
  controller: AbortController;
  subscribers: Map<string, Subscriber>;
  queuedAt: number;
  startedAt?: number;
  deadlineMs: number;
  state: "queued" | "running";
  queueTimer?: ReturnType<typeof setTimeout>;
  lastProgress: number;
  phase: number;
  processedBytes?: number;
};

export type Marker = {
  requestId: string;
  owner: string;
  public: boolean;
};

export class AnalysisCoordinator {
  private jobs: Job[] = [];
  private active: Job | undefined;

  constructor(
    private readonly execute: (
      job: {
        id: string;
        resolution: ResolutionEnvelope;
        token?: string;
        generation: string;
        ignore: IgnoreSettings;
        limits: Readonly<JobLimits>;
        onLimitsRaised: (listener: () => void) => void;
        signal: AbortSignal;
      },
      progress: (
        phase: "downloading" | "decompressing" | "counting",
        processedBytes?: number,
      ) => void,
    ) => Promise<AnalysisOutput>,
    private readonly changed: (markers: Marker[]) => void,
    private readonly now: () => number = Date.now,
  ) {}

  private notify(): void {
    this.changed(
      this.jobs.flatMap((job) =>
        [...job.subscribers.values()].map((subscriber) => ({
          requestId: subscriber.requestId,
          owner: subscriber.owner,
          public: subscriber.public,
        })),
      ),
    );
  }

  private finish(job: Job): void {
    clearTimeout(job.queueTimer);
    this.jobs = this.jobs.filter((item) => item !== job);
    if (this.active === job) this.active = undefined;
    this.notify();
    this.pump();
  }

  private manual(job: Job): boolean {
    return [...job.subscribers.values()].some((item) => !item.automatic);
  }

  private queued(): Job[] {
    return this.jobs.filter((item) => item.state === "queued");
  }

  private pump(): void {
    if (this.active) return;
    const queued = this.queued();
    const job = queued.find((item) => this.manual(item)) ?? queued[0];
    if (!job) return;
    if (this.now() - job.queuedAt >= QUEUE_WAIT_MS) {
      for (const subscriber of job.subscribers.values())
        subscriber.onFailure(new Error("analysis_busy"), job.controller.signal);
      this.finish(job);
      return;
    }
    this.active = job;
    job.state = "running";
    job.startedAt = this.now();
    clearTimeout(job.queueTimer);
    this.report(job, "downloading", 0);
    const deadline = setTimeout(
      () => job.controller.abort("deadline"),
      job.deadlineMs,
    );
    const progress = (phase: ProgressPhase, processedBytes?: number) =>
      this.report(job, phase, processedBytes);
    void this.execute(
      {
        id: job.id,
        resolution: job.resolution,
        token: job.token,
        generation: job.generation,
        ignore: job.ignore,
        limits: job.limits,
        onLimitsRaised: (listener) => job.raised.add(listener),
        signal: job.controller.signal,
      },
      progress,
    )
      .then(
        async (output) => {
          if (job.controller.signal.aborted) {
            for (const subscriber of job.subscribers.values())
              subscriber.onFailure(
                new Error("analysis_canceled"),
                job.controller.signal,
              );
          } else {
            const completed = {
              ...output,
              durationMs: Math.max(0, this.now() - (job.startedAt ?? 0)),
            };
            await Promise.all(
              [...job.subscribers.values()].map((subscriber) =>
                subscriber.onComplete(completed, job.resolution),
              ),
            );
          }
        },
        (error: unknown) => {
          for (const subscriber of job.subscribers.values())
            subscriber.onFailure(error, job.controller.signal);
        },
      )
      .finally(() => {
        clearTimeout(deadline);
        this.finish(job);
      })
      .catch(() => undefined);
  }

  subscribe(
    identity: string,
    resolution: ResolutionEnvelope,
    token: string | undefined,
    generation: string,
    subscriber: Subscriber,
    deadlineMs = ARCHIVE_TIMEOUTS.job,
    ignore: IgnoreSettings = defaultIgnore,
  ): boolean {
    this.detachOwner(subscriber.owner);
    if (this.subscriptionCount() >= SUBSCRIPTIONS) return false;
    let job = this.jobs.find(
      (item) => item.identity === identity && !item.controller.signal.aborted,
    );
    if (!job) {
      const queued = this.queued();
      if (queued.length >= QUEUED_JOBS) {
        const evicted = subscriber.automatic
          ? undefined
          : queued.find((item) => !this.manual(item));
        if (!evicted) return false;
        for (const item of [...evicted.subscribers.values()])
          this.detach(item.owner, item.requestId);
      }
      job = {
        identity,
        resolution,
        token,
        generation,
        ignore,
        limits: jobLimits(DOWNLOAD_LIMITS.automatic),
        raised: new Set(),
        id: crypto.randomUUID(),
        controller: new AbortController(),
        subscribers: new Map(),
        queuedAt: this.now(),
        deadlineMs,
        state: "queued",
        lastProgress: Number.NEGATIVE_INFINITY,
        phase: -1,
      };
      this.jobs.push(job);
      job.queueTimer = setTimeout(() => {
        if (job?.state !== "queued") return;
        for (const item of job.subscribers.values())
          item.onFailure(new Error("analysis_busy"), job.controller.signal);
        this.finish(job);
      }, QUEUE_WAIT_MS);
    }
    job.subscribers.set(subscriber.requestId, subscriber);
    const limit =
      subscriber.limit ??
      (subscriber.automatic
        ? DOWNLOAD_LIMITS.automatic
        : DOWNLOAD_LIMITS.fallback);
    if (limit > job.limits.compressed) {
      Object.assign(job.limits, jobLimits(limit));
      for (const listener of job.raised) listener();
    }
    this.notify();
    if (job.state === "queued" && this.active) subscriber.onProgress("queued");
    else if (job.state === "running" && job.phase >= 0)
      subscriber.onProgress(
        phaseOrder[job.phase]!,
        job.processedBytes,
        job.startedAt,
      );
    this.pump();
    return true;
  }

  detach(owner: string, requestId: string): boolean {
    const job = this.jobs.find(
      (item) => item.subscribers.get(requestId)?.owner === owner,
    );
    if (!job) return false;
    job.subscribers
      .get(requestId)
      ?.onFailure(new Error("analysis_canceled"), job.controller.signal);
    job.subscribers.delete(requestId);
    if (!job.subscribers.size) {
      job.controller.abort("cancel");
      if (job.state === "queued") this.finish(job);
    }
    this.notify();
    return true;
  }

  detachOwner(owner: string): void {
    const subscriptions = this.jobs.flatMap((job) =>
      [...job.subscribers.values()].filter((item) => item.owner === owner),
    );
    for (const item of subscriptions) this.detach(owner, item.requestId);
  }

  detachDocument(prefix: string): void {
    const subscriptions = this.jobs.flatMap((job) =>
      [...job.subscribers.values()].filter((item) =>
        item.owner.startsWith(prefix),
      ),
    );
    for (const item of subscriptions) this.detach(item.owner, item.requestId);
  }

  startedAt(owner: string): number | undefined {
    return this.jobs.find((item) =>
      [...item.subscribers.values()].some(
        (subscriber) => subscriber.owner === owner,
      ),
    )?.startedAt;
  }

  status(owner: string): "idle" | "queued" | "running" {
    const job = this.jobs.find((item) =>
      [...item.subscribers.values()].some(
        (subscriber) => subscriber.owner === owner,
      ),
    );
    return job?.state ?? "idle";
  }

  isSubscribed(owner: string, requestId: string): boolean {
    return this.jobs.some(
      (job) =>
        !job.controller.signal.aborted &&
        job.subscribers.get(requestId)?.owner === owner,
    );
  }

  reportCounting(jobId: string): boolean {
    const job = this.active;
    if (!job || job.id !== jobId) return false;
    this.report(job, "counting");
    return true;
  }

  private report(
    job: Job,
    phase: ProgressPhase,
    processedBytes?: number,
  ): void {
    const rank = phaseOrder.indexOf(phase);
    const now = this.now();
    const moved =
      processedBytes !== undefined && processedBytes !== job.processedBytes;
    if (processedBytes !== undefined) job.processedBytes = processedBytes;
    if (
      rank <= job.phase &&
      ((rank < job.phase && !moved) ||
        now - job.lastProgress < PROGRESS_INTERVAL_MS)
    )
      return;
    job.phase = Math.max(rank, job.phase);
    job.lastProgress = now;
    for (const subscriber of job.subscribers.values())
      subscriber.onProgress(
        phaseOrder[job.phase]!,
        job.processedBytes,
        job.startedAt,
      );
  }

  subscriptionCount(): number {
    return this.jobs.reduce((count, job) => count + job.subscribers.size, 0);
  }

  abortAll(reason: string): void {
    for (const job of [...this.jobs]) {
      job.controller.abort(reason);
      for (const item of [...job.subscribers.values()])
        this.detach(item.owner, item.requestId);
    }
  }

  abortGeneration(generation: string): void {
    for (const job of [...this.jobs]) {
      if (job.generation !== generation) continue;
      job.controller.abort("disconnect");
      for (const item of [...job.subscribers.values()])
        this.detach(item.owner, item.requestId);
    }
  }

  abortPublicRepository(repositoryId: string): void {
    for (const job of [...this.jobs]) {
      if (
        job.resolution.visibility !== "public" ||
        job.resolution.repositoryId !== repositoryId
      )
        continue;
      job.controller.abort("visibility");
      for (const item of [...job.subscribers.values()])
        this.detach(item.owner, item.requestId);
    }
  }
}
