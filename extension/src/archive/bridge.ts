import { offscreen } from "../background/offscreen";
import type { AnalysisResultV2 } from "../counter/result";
import { validateResult } from "../counter/result";
import {
  defaultIgnore,
  effectiveRulesHash,
  type IgnoreSettings,
} from "../counter/rules";
import { openArchive, type Resolution } from "../github/client";
import { ARCHIVE_TIMEOUTS } from "./limits";
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
  result?: unknown;
  metrics?: ArchiveMetrics;
  wasmLinearMemoryBytes?: number;
};

let activeJobs = 0;

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
  ) => void,
  ignore: IgnoreSettings = defaultIgnore,
): Promise<{
  result: AnalysisResultV2;
  transport: ArchiveMetrics & { compressedBytes: number };
  wasmLinearMemoryBytes: number;
}> {
  const download = new AbortController();
  try {
    const stream = await waitFor(
      openArchive(
        fetch,
        resolution,
        token,
        AbortSignal.any([signal, download.signal]),
      ),
      signal,
      ARCHIVE_TIMEOUTS.networkIdle,
    );
    return await analyzeArchiveStream(
      stream,
      resolution,
      signal,
      jobId,
      0,
      onProgress,
      ignore,
    );
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
  ) => void,
  ignore: IgnoreSettings = defaultIgnore,
): Promise<{
  result: AnalysisResultV2;
  transport: ArchiveMetrics & { compressedBytes: number };
  wasmLinearMemoryBytes: number;
}> {
  const reader = stream.getReader();
  activeJobs++;
  const host = offscreen.acquire();
  let started = false;
  let compressedBytes = 0;
  let sequence = 0;
  const onAbort = () => {
    if (started) void command("archive.cancel", jobId).catch(() => undefined);
    void reader.cancel().catch(() => undefined);
  };
  signal.addEventListener("abort", onAbort, { once: true });
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
      }),
      "started",
    );
    started = true;
    onProgress?.("downloading", 0);
    for (;;) {
      if (signal.aborted) throw abortError(signal);
      const { done, value } = await waitFor(
        reader.read(),
        signal,
        ARCHIVE_TIMEOUTS.networkIdle,
      );
      if (done) break;
      compressedBytes += value.byteLength;
      if (compressedBytes > ARCHIVE_LIMITS.compressed)
        throw new ArchiveError("compressed_limit_exceeded", "compressed");
      onProgress?.("downloading", compressedBytes);
      for (
        let offset = 0;
        offset < value.byteLength;
        offset += ARCHIVE_LIMITS.chunk
      ) {
        if (signal.aborted) throw abortError(signal);
        sequence++;
        requireState(
          await command("archive.chunk", jobId, {
            sequence,
            bytes: Array.from(
              value.subarray(offset, offset + ARCHIVE_LIMITS.chunk),
            ),
          }),
          "ok",
        );
      }
    }
    onProgress?.("decompressing");
    const outcome = await command("archive.finish", jobId);
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
