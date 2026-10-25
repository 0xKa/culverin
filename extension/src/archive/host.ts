import { validateResult } from "../counter/result";
import { normalizeIgnore } from "../counter/rules";
import { ARCHIVE_LIMITS, type ArchiveMetrics } from "./tar";
import { ARCHIVE_TIMEOUTS, DOWNLOAD_LIMITS, validFileCount } from "./limits";

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
  decompressed: number;
  pending?: Reply;
  finish?: Reply;
  outcome?: unknown;
  lease: ReturnType<typeof setTimeout>;
  deadline: ReturnType<typeof setTimeout>;
  idle: ReturnType<typeof setTimeout>;
};

let active: Active | undefined;

function validMetrics(
  value: unknown,
  decompressed: number,
): value is ArchiveMetrics {
  if (!value || typeof value !== "object") return false;
  const metrics = value as Record<string, unknown>;
  const bounds: Record<keyof ArchiveMetrics, number> = {
    decompressedBytes: decompressed,
    entries: ARCHIVE_LIMITS.entries,
    regularFiles: ARCHIVE_LIMITS.regularFiles,
    specialEntries: ARCHIVE_LIMITS.entries,
    wasmBytes: decompressed,
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

const encodedChunk = Math.ceil(ARCHIVE_LIMITS.chunk / 3) * 4;

function decodeChunk(value: unknown): Uint8Array | undefined {
  if (
    typeof value !== "string" ||
    value.length > encodedChunk ||
    value.length % 4 !== 0 ||
    !/^[A-Za-z0-9+/]*={0,2}$/.test(value)
  )
    return undefined;
  let binary: string;
  try {
    binary = atob(value);
  } catch {
    return undefined;
  }
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++)
    bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function acceptChunk(
  job: Active,
  sequence: unknown,
  bytes: Uint8Array | undefined,
  respond: Reply,
): boolean {
  if (
    job.outcome ||
    job.pending ||
    !bytes ||
    bytes.byteLength > ARCHIVE_LIMITS.chunk ||
    sequence !== job.sequence + 1
  ) {
    respond(job.outcome ?? { state: "failed", code: "archive_invalid" });
    return false;
  }
  job.sequence++;
  job.pending = respond;
  job.worker.postMessage({ type: "chunk", sequence: job.sequence, bytes }, [
    bytes.buffer,
  ]);
  return true;
}

export function handleArchiveData(event: {
  data: unknown;
  source: unknown;
}): boolean {
  const source = event.source as {
    scriptURL?: unknown;
    postMessage?: (message: unknown) => void;
  } | null;
  const value = event.data as Record<string, unknown> | null;
  if (
    !source ||
    source.scriptURL !== chrome.runtime.getURL("background.js") ||
    typeof source.postMessage !== "function" ||
    !value ||
    typeof value !== "object" ||
    value.target !== "archive.data" ||
    value.protocolVersion !== 1 ||
    typeof value.jobId !== "string" ||
    !Number.isSafeInteger(value.sequence)
  )
    return false;
  const respond = (response: unknown) =>
    source.postMessage!({
      target: "archive.reply",
      jobId: value.jobId,
      sequence: value.sequence,
      response,
    });
  const job = active;
  if (!job || value.jobId !== job.id) {
    respond({ state: "interrupted" });
    return false;
  }
  return acceptChunk(
    job,
    value.sequence,
    value.bytes instanceof ArrayBuffer
      ? new Uint8Array(value.bytes)
      : undefined,
    respond,
  );
}

export function listenForArchiveData(
  container: ServiceWorkerContainer = navigator.serviceWorker,
): void {
  container.addEventListener("message", (event) => {
    handleArchiveData(event);
  });
  container.startMessages();
}

function validDecompressed(value: unknown): value is number {
  return (
    Number.isSafeInteger(value) &&
    (value as number) > 0 &&
    (value as number) <= DOWNLOAD_LIMITS.maximum * DOWNLOAD_LIMITS.unpackedRatio
  );
}

function validLimits(value: unknown): value is { decompressed: number } {
  return (
    !!value &&
    typeof value === "object" &&
    Object.keys(value).join("|") === "decompressed" &&
    validDecompressed((value as { decompressed: unknown }).decompressed)
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
  createWorker: () => Worker = () =>
    new Worker(new URL("./worker.ts", import.meta.url), { type: "module" }),
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
  if (command.type === "archive.reconcile") {
    stopArchive();
    respond({ ok: true });
    return false;
  }
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
      !validLimits(command.limits) ||
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
    const worker = createWorker();
    const job: Active = {
      id: command.jobId,
      worker,
      sequence: 0,
      decompressed: command.limits.decompressed,
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
        pending?.({
          state: "ok",
          ...(validFileCount(value.files) ? { files: value.files } : {}),
        });
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
          validMetrics(value.metrics, job.decompressed) &&
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
                limitBytes: Number.isSafeInteger(value.limitBytes)
                  ? value.limitBytes
                  : undefined,
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
      decompressed: job.decompressed,
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
  if (command.type === "archive.limits") {
    if (!validLimits(command.limits)) {
      respond({ state: "failed", code: "archive_invalid" });
      return false;
    }
    job.decompressed = Math.max(job.decompressed, command.limits.decompressed);
    job.worker.postMessage({ type: "limits", decompressed: job.decompressed });
    respond({ state: "ok" });
    return false;
  }
  if (command.type === "archive.cancel") {
    stop({ state: "canceled" });
    respond({ state: "canceled" });
    return false;
  }
  if (command.type === "archive.chunk")
    return acceptChunk(
      job,
      command.sequence,
      decodeChunk(command.bytes),
      respond,
    );
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
