import { offscreen } from "../background/offscreen";
import type { AnalysisResultV2 } from "../counter/result";
import { validateResult } from "../counter/result";
import {
  defaultIgnore,
  effectiveRulesHash,
  type IgnoreSettings,
} from "../counter/rules";
import { openArchive, type Resolution } from "../github/client";
import {
  ARCHIVE_TIMEOUTS,
  DOWNLOAD_LIMITS,
  jobLimits,
  type JobLimits,
  validFileCount,
} from "./limits";
import { abortError, waitFor } from "./timeout";
import {
  ARCHIVE_LIMITS,
  ArchiveError,
  type ArchiveErrorCode,
  type ArchiveMetrics,
} from "./tar";

type HostResponse = {
  state: string;
  code?: string;
  limit?: string;
  limitBytes?: number;
  result?: unknown;
  metrics?: ArchiveMetrics;
  wasmLinearMemoryBytes?: number;
  files?: number;
};

type OffscreenClient = {
  url: string;
  postMessage(message: unknown, transfer: Transferable[]): void;
};
type ClientsScope = {
  clients?: {
    matchAll(options: {
      includeUncontrolled: boolean;
      type: "window";
    }): Promise<OffscreenClient[]>;
  };
};
type ReplyEvent = { data: unknown; source: unknown };
type ArchiveOutput = {
  result: AnalysisResultV2;
  transport: ArchiveMetrics & { compressedBytes: number };
  wasmLinearMemoryBytes: number;
  githubWaitMs: number;
  counterWaitMs: number;
};

let activeJobs = 0;
const replies = new Map<
  string,
  { sequence: number; resolve: (value: HostResponse) => void }
>();

export function archiveBridgeActive(): boolean {
  return activeJobs > 0;
}

async function command(
  type: string,
  jobId: string,
  extra: Record<string, unknown> = {},
): Promise<HostResponse> {
  return chrome.runtime.sendMessage({
    target: "archive.host",
    protocolVersion: 1,
    type,
    jobId,
    ...extra,
  }) as Promise<HostResponse>;
}

async function offscreenClient(): Promise<OffscreenClient | undefined> {
  const url = chrome.runtime.getURL("offscreen.html");
  const clients = await (globalThis as ClientsScope).clients
    ?.matchAll({ includeUncontrolled: true, type: "window" })
    .catch(() => undefined);
  return clients?.find((client) => client.url === url);
}

export function handleArchiveReply(event: ReplyEvent): boolean {
  const source = event.source as { url?: unknown } | null;
  const value = event.data as Record<string, unknown> | null;
  if (
    source?.url !== chrome.runtime.getURL("offscreen.html") ||
    !value ||
    typeof value !== "object" ||
    value.target !== "archive.reply" ||
    typeof value.jobId !== "string"
  )
    return false;
  const waiting = replies.get(value.jobId);
  if (!waiting || value.sequence !== waiting.sequence) return false;
  replies.delete(value.jobId);
  waiting.resolve(value.response as HostResponse);
  return true;
}

function sendData(
  client: OffscreenClient,
  jobId: string,
  sequence: number,
  bytes: Uint8Array,
  signal: AbortSignal,
): Promise<HostResponse> {
  const reply = new Promise<HostResponse>((resolve) =>
    replies.set(jobId, { sequence, resolve }),
  );
  const buffer = bytes.slice().buffer;
  client.postMessage(
    {
      target: "archive.data",
      protocolVersion: 1,
      jobId,
      sequence,
      bytes: buffer,
    },
    [buffer],
  );
  return waitFor(
    reply,
    signal,
    ARCHIVE_TIMEOUTS.workerIdle + ARCHIVE_TIMEOUTS.lease,
  ).finally(() => {
    if (replies.get(jobId)?.sequence === sequence) replies.delete(jobId);
  });
}

export function encodeChunk(bytes: Uint8Array): string {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000)
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  return btoa(binary);
}

function requireState(value: HostResponse, state: string): void {
  if (value?.state === state) return;
  if (value?.state === "canceled") throw new ArchiveError("analysis_canceled");
  if (value?.state === "interrupted")
    throw new ArchiveError("analysis_interrupted");
  const codes: ArchiveErrorCode[] = [
    "compressed_limit_exceeded",
    "decompressed_limit_exceeded",
    "entry_limit_exceeded",
    "file_limit_exceeded",
    "metadata_limit_exceeded",
    "archive_invalid",
    "archive_unsupported",
    "analysis_canceled",
    "analysis_timeout",
    "analysis_interrupted",
    "analysis_busy",
    "counter_failed",
  ];
  const code = codes.find((item) => item === value?.code) ?? "counter_failed";
  const limit = Object.keys(ARCHIVE_LIMITS).find(
    (item) => item === value?.limit,
  );
  throw new ArchiveError(
    code,
    limit as keyof typeof ARCHIVE_LIMITS | undefined,
    Number.isSafeInteger(value?.limitBytes) ? value.limitBytes : undefined,
  );
}

export async function analyzeArchive(
  resolution: Resolution,
  token: string | undefined,
  signal: AbortSignal,
  jobId: string,
  onProgress?: (
    phase: "downloading" | "decompressing",
    processedBytes?: number,
    processedFiles?: number,
  ) => void,
  ignore: IgnoreSettings = defaultIgnore,
  limits: Readonly<JobLimits> = jobLimits(DOWNLOAD_LIMITS.automatic),
  onLimitsRaised?: (listener: () => void) => void,
): Promise<ArchiveOutput> {
  const download = new AbortController();
  try {
    const opening = performance.now();
    const stream = await waitFor(
      openArchive(
        fetch,
        resolution,
        token,
        AbortSignal.any([signal, download.signal]),
        limits.compressed,
      ),
      signal,
      ARCHIVE_TIMEOUTS.networkIdle,
    );
    const opened = Math.round(performance.now() - opening);
    const output = await analyzeArchiveStream(
      stream,
      resolution,
      signal,
      jobId,
      0,
      onProgress,
      ignore,
      limits,
      onLimitsRaised,
    );
    return { ...output, githubWaitMs: output.githubWaitMs + opened };
  } finally {
    download.abort();
  }
}

export async function analyzeArchiveStream(
  stream: ReadableStream<Uint8Array>,
  resolution: Pick<Resolution, "repositoryId" | "sha">,
  signal: AbortSignal,
  jobId: string,
  blockMs = 0,
  onProgress?: (
    phase: "downloading" | "decompressing",
    processedBytes?: number,
    processedFiles?: number,
  ) => void,
  ignore: IgnoreSettings = defaultIgnore,
  limits: Readonly<JobLimits> = jobLimits(DOWNLOAD_LIMITS.automatic),
  onLimitsRaised?: (listener: () => void) => void,
): Promise<ArchiveOutput> {
  const reader = stream.getReader();
  activeJobs++;
  const host = offscreen.acquire();
  let started = false;
  let compressedBytes = 0;
  let sequence = 0;
  let githubWait = 0;
  let counterWait = 0;
  let files: number | undefined;
  const onAbort = () => {
    if (started) void command("archive.cancel", jobId).catch(() => undefined);
    void reader.cancel().catch(() => undefined);
  };
  signal.addEventListener("abort", onAbort, { once: true });
  let sentDecompressed = limits.decompressed;
  const syncLimits = () => {
    if (!started || limits.decompressed <= sentDecompressed) return;
    sentDecompressed = limits.decompressed;
    void command("archive.limits", jobId, {
      limits: { decompressed: sentDecompressed },
    }).catch(() => undefined);
  };
  onLimitsRaised?.(syncLimits);
  const lease = setInterval(() => {
    if (started) void command("archive.renew", jobId).catch(() => undefined);
  }, ARCHIVE_TIMEOUTS.renew);
  try {
    if (signal.aborted) throw abortError(signal);
    await waitFor(host.ready, signal, ARCHIVE_TIMEOUTS.networkIdle);
    if (signal.aborted) throw abortError(signal);
    requireState(
      await command("archive.start", jobId, {
        rules: {
          repositoryId: resolution.repositoryId,
          commitSha: resolution.sha,
          disabledGroups: ignore.disabledGroups,
          exclusions: ignore.exclusions,
        },
        blockMs,
        limits: { decompressed: sentDecompressed },
      }),
      "started",
    );
    started = true;
    syncLimits();
    const client = await offscreenClient();
    onProgress?.("downloading", 0);
    for (;;) {
      if (signal.aborted) throw abortError(signal);
      const reading = performance.now();
      const { done, value } = await waitFor(
        reader.read(),
        signal,
        ARCHIVE_TIMEOUTS.networkIdle,
      );
      githubWait += performance.now() - reading;
      if (done) break;
      compressedBytes += value.byteLength;
      if (compressedBytes > limits.compressed)
        throw new ArchiveError(
          "compressed_limit_exceeded",
          "compressed",
          limits.compressed,
        );
      onProgress?.("downloading", compressedBytes, files);
      for (
        let offset = 0;
        offset < value.byteLength;
        offset += ARCHIVE_LIMITS.chunk
      ) {
        if (signal.aborted) throw abortError(signal);
        sequence++;
        const bytes = value.subarray(offset, offset + ARCHIVE_LIMITS.chunk);
        const sending = performance.now();
        const accepted = client
          ? await sendData(client, jobId, sequence, bytes, signal)
          : await command("archive.chunk", jobId, {
              sequence,
              bytes: encodeChunk(bytes),
            });
        counterWait += performance.now() - sending;
        requireState(accepted, "ok");
        if (validFileCount(accepted.files)) files = accepted.files;
      }
    }
    onProgress?.("decompressing");
    const finishing = performance.now();
    const outcome = await command("archive.finish", jobId);
    counterWait += performance.now() - finishing;
    requireState(outcome, "completed");
    if (
      !validateResult(outcome.result) ||
      !outcome.metrics ||
      outcome.wasmLinearMemoryBytes === undefined ||
      outcome.result.repository.id !== resolution.repositoryId ||
      outcome.result.revision.commitSha !== resolution.sha ||
      outcome.result.engine.rulesHash !== (await effectiveRulesHash(ignore))
    )
      throw new ArchiveError("counter_failed");
    return {
      result: outcome.result,
      transport: { ...outcome.metrics, compressedBytes },
      wasmLinearMemoryBytes: outcome.wasmLinearMemoryBytes,
      githubWaitMs: Math.round(githubWait),
      counterWaitMs: Math.round(counterWait),
    };
  } catch (error) {
    if (started) await command("archive.cancel", jobId).catch(() => undefined);
    if (signal.aborted) throw abortError(signal);
    throw error;
  } finally {
    clearInterval(lease);
    signal.removeEventListener("abort", onAbort);
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
    activeJobs--;
    host.release();
  }
}
