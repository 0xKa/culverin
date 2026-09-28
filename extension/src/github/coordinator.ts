import type { AnalysisResultV2 } from "../counter/result";
import type { ResolutionEnvelope } from "./public-protocol";

export const QUEUED_JOBS = 8;
export const QUEUE_WAIT_MS = 30_000;
export const SUBSCRIPTIONS = 32;
export const PROGRESS_INTERVAL_MS = 250;

export type AnalysisOutput = {
  result: AnalysisResultV2;
  transport: {
    compressedBytes: number;
    decompressedBytes: number;
  };
  wasmLinearMemoryBytes: number;
};

export type Subscriber = {
  requestId: string;
  owner: string;
  public: boolean;
  onProgress: (
    phase: "queued" | "downloading" | "decompressing" | "counting",
    processedBytes?: number,
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
  id: string;
  controller: AbortController;
  subscribers: Map<string, Subscriber>;
  queuedAt: number;
  deadlineMs: number;
  state: "queued" | "running";
  queueTimer?: ReturnType<typeof setTimeout>;
  lastProgress: number;
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

  private pump(): void {
    if (this.active) return;
    const job = this.jobs.find((item) => item.state === "queued");
    if (!job) return;
    if (this.now() - job.queuedAt >= QUEUE_WAIT_MS) {
      for (const subscriber of job.subscribers.values())
        subscriber.onFailure(new Error("analysis_busy"), job.controller.signal);
      this.finish(job);
      return;
    }
    this.active = job;
    job.state = "running";
    clearTimeout(job.queueTimer);
    const deadline = setTimeout(
      () => job.controller.abort("deadline"),
      job.deadlineMs,
    );
    const progress = (
      phase: "downloading" | "decompressing" | "counting",
      processedBytes?: number,
    ) => {
      const now = this.now();
      if (now - job.lastProgress < PROGRESS_INTERVAL_MS) return;
      job.lastProgress = now;
      for (const subscriber of job.subscribers.values())
        subscriber.onProgress(phase, processedBytes);
    };
    void this.execute(
      {
        id: job.id,
        resolution: job.resolution,
        token: job.token,
        generation: job.generation,
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
            await Promise.all(
              [...job.subscribers.values()].map((subscriber) =>
                subscriber.onComplete(output, job.resolution),
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
    deadlineMs = 25_000,
  ): boolean {
    this.detachOwner(subscriber.owner);
    if (this.subscriptionCount() >= SUBSCRIPTIONS) return false;
    let job = this.jobs.find(
      (item) => item.identity === identity && !item.controller.signal.aborted,
    );
    if (!job) {
      if (
        this.jobs.filter((item) => item.state === "queued").length >=
        QUEUED_JOBS
      )
        return false;
      job = {
        identity,
        resolution,
        token,
        generation,
        id: crypto.randomUUID(),
        controller: new AbortController(),
        subscribers: new Map(),
        queuedAt: this.now(),
        deadlineMs,
        state: "queued",
        lastProgress: Number.NEGATIVE_INFINITY,
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
    this.notify();
    if (job.state === "queued" && this.active) subscriber.onProgress("queued");
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
    const now = this.now();
    if (now - job.lastProgress >= PROGRESS_INTERVAL_MS) {
      job.lastProgress = now;
      for (const subscriber of job.subscribers.values())
        subscriber.onProgress("counting");
    }
    return true;
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
