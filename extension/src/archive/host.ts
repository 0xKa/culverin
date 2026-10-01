import { validateResult } from "../counter/result";
import { normalizeIgnore } from "../counter/rules";
import { ARCHIVE_LIMITS, type ArchiveMetrics } from "./tar";
import { ARCHIVE_TIMEOUTS } from "./limits";

function validIgnore(value: unknown): boolean {
  try {
    normalizeIgnore(value);
    return true;
  } catch {
    return false;
  }
}

type Reply = (value: unknown) => void;
type Active = {
  id: string;
  worker: Worker;
  sequence: number;
  pending?: Reply;
  finish?: Reply;
  outcome?: unknown;
  lease: ReturnType<typeof setTimeout>;
  deadline: ReturnType<typeof setTimeout>;
  idle: ReturnType<typeof setTimeout>;
};

let active: Active | undefined;

function validMetrics(value: unknown): value is ArchiveMetrics {
  if (!value || typeof value !== "object") return false;
  const metrics = value as Record<string, unknown>;
  const bounds: Record<keyof ArchiveMetrics, number> = {
    decompressedBytes: ARCHIVE_LIMITS.decompressed,
    entries: ARCHIVE_LIMITS.entries,
    regularFiles: ARCHIVE_LIMITS.regularFiles,
    specialEntries: ARCHIVE_LIMITS.entries,
    wasmBytes: ARCHIVE_LIMITS.wasmBytes,
    retainedPathBytes: ARCHIVE_LIMITS.retainedPaths,
  };
  return (
    Object.keys(metrics).length === Object.keys(bounds).length &&
    Object.entries(bounds).every(
      ([key, bound]) =>
        Number.isSafeInteger(metrics[key]) &&
        (metrics[key] as number) >= 0 &&
        (metrics[key] as number) <= bound,
    ) &&
    metrics.entries ===
      (metrics.regularFiles as number) + (metrics.specialEntries as number)
  );
}

export function archiveHostActive(): boolean {
  return Boolean(active);
}

function stop(outcome: unknown): void {
  const job = active;
  if (!job) return;
  active = undefined;
  clearTimeout(job.lease);
  clearTimeout(job.deadline);
  clearTimeout(job.idle);
  job.worker.terminate();
  job.pending?.(outcome);
  job.finish?.(outcome);
}

export function stopArchive(): void {
  stop({ state: "interrupted" });
}

function renew(job: Active): void {
  clearTimeout(job.lease);
  job.lease = setTimeout(
    () => stop({ state: "interrupted" }),
    ARCHIVE_TIMEOUTS.lease,
  );
}

function activity(job: Active): void {
  clearTimeout(job.idle);
  job.idle = setTimeout(
    () => stop({ state: "failed", code: "analysis_timeout" }),
    ARCHIVE_TIMEOUTS.workerIdle,
  );
}

export function handleArchiveHost(
  message: unknown,
  sender: chrome.runtime.MessageSender,
  respond: Reply,
  fixtureActive: boolean,
): boolean {
  if (
    sender.id !== chrome.runtime.id ||
    sender.url !== chrome.runtime.getURL("background.js") ||
    !message ||
    typeof message !== "object"
  )
    return false;
  const command = message as Record<string, unknown>;
  if (command.target !== "archive.host" || command.protocolVersion !== 1)
    return false;
  if (command.type === "archive.status") {
    respond({ state: fixtureActive || active ? "busy" : "idle" });
    return false;
  }
  if (command.type === "archive.start") {
    if (
      fixtureActive ||
      active ||
      typeof command.jobId !== "string" ||
      !/^[0-9a-f-]{36}$/.test(command.jobId) ||
      !Number.isInteger(command.blockMs) ||
      (command.blockMs as number) < 0 ||
      (command.blockMs as number) > 10_000 ||
      !command.rules ||
      typeof command.rules !== "object"
    ) {
      respond({ state: "failed", code: "analysis_busy" });
      return false;
    }
    const rules = command.rules as Record<string, unknown>;
    if (
      typeof rules.repositoryId !== "string" ||
      typeof rules.commitSha !== "string" ||
      Object.keys(rules).sort().join("|") !==
        "commitSha|disabledGroups|exclusions|repositoryId" ||
      !/^[1-9][0-9]*$/.test(rules.repositoryId) ||
      !/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(rules.commitSha) ||
      !validIgnore({
        disabledGroups: rules.disabledGroups,
        exclusions: rules.exclusions,
      })
    ) {
      respond({ state: "failed", code: "archive_invalid" });
      return false;
    }
    const worker = new Worker(new URL("./worker.ts", import.meta.url), {
      type: "module",
    });
    const job: Active = {
      id: command.jobId,
      worker,
      sequence: 0,
      lease: setTimeout(
        () => stop({ state: "interrupted" }),
        ARCHIVE_TIMEOUTS.lease,
      ),
      deadline: setTimeout(
        () => stop({ state: "failed", code: "analysis_timeout" }),
        ARCHIVE_TIMEOUTS.job,
      ),
      idle: setTimeout(
        () => stop({ state: "failed", code: "analysis_timeout" }),
        ARCHIVE_TIMEOUTS.workerIdle,
      ),
    };
    active = job;
    worker.onmessage = (event: MessageEvent<unknown>) => {
      if (active !== job || !event.data || typeof event.data !== "object")
        return;
      const value = event.data as Record<string, unknown>;
      if (value.type === "ack" && value.sequence === job.sequence) {
        activity(job);
        const pending = job.pending;
        job.pending = undefined;
        pending?.({ state: "ok" });
      } else if (value.type === "counting") {
        activity(job);
        void chrome.runtime.sendMessage({
          type: "archive.counting",
          requestId: job.id,
        });
      } else if (value.type === "activity") {
        activity(job);
      } else if (value.type === "result") {
        clearTimeout(job.idle);
        const outcome =
          value.ok === true &&
          validateResult(value.result) &&
          validMetrics(value.metrics) &&
          Number.isSafeInteger(value.wasmLinearMemoryBytes) &&
          (value.wasmLinearMemoryBytes as number) >= 0 &&
          (value.wasmLinearMemoryBytes as number) <= 512 * 1024 * 1024
            ? {
                state: "completed",
                result: value.result,
                metrics: value.metrics,
                wasmLinearMemoryBytes: value.wasmLinearMemoryBytes,
              }
            : {
                state: "failed",
                code:
                  value.ok === false && typeof value.code === "string"
                    ? value.code
                    : "counter_failed",
                limit:
                  typeof value.limit === "string" ? value.limit : undefined,
              };
        job.outcome = outcome;
        if (job.pending) {
          job.pending(outcome);
          job.pending = undefined;
        }
        if (job.finish) stop(outcome);
      }
    };
    worker.onerror = () => stop({ state: "failed", code: "counter_failed" });
    worker.postMessage({
      type: "start",
      rules: JSON.stringify(rules),
      blockMs: command.blockMs,
    });
    respond({ state: "started" });
    return false;
  }
  const job = active;
  if (!job || command.jobId !== job.id) {
    respond({ state: "interrupted" });
    return false;
  }
  if (command.type === "archive.renew") {
    renew(job);
    respond({ state: "ok" });
    return false;
  }
  if (command.type === "archive.cancel") {
    stop({ state: "canceled" });
    respond({ state: "canceled" });
    return false;
  }
  if (command.type === "archive.chunk") {
    const bytes = command.bytes;
    if (
      job.outcome ||
      job.pending ||
      !Array.isArray(bytes) ||
      bytes.length > 64 * 1024 ||
      !bytes.every(
        (value) => Number.isInteger(value) && value >= 0 && value <= 255,
      ) ||
      command.sequence !== job.sequence + 1
    ) {
      respond(job.outcome ?? { state: "failed", code: "archive_invalid" });
      return false;
    }
    job.sequence++;
    job.pending = respond;
    const chunk = Uint8Array.from(bytes);
    job.worker.postMessage(
      { type: "chunk", sequence: job.sequence, bytes: chunk },
      [chunk.buffer],
    );
    return true;
  }
  if (command.type === "archive.finish") {
    if (job.pending) {
      respond({ state: "failed", code: "archive_invalid" });
      return false;
    }
    if (job.outcome) {
      stop(job.outcome);
      respond(job.outcome);
      return false;
    }
    job.finish = respond;
    job.worker.postMessage({ type: "finish" });
    return true;
  }
  return false;
}
