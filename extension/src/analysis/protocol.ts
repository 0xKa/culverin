import type { AnalysisResultV1 } from "../counter/result";
import type { CounterRules } from "../counter/runner";

export const PROTOCOL_VERSION = 1;
export const JOB_DEADLINE_MS = 25_000;
export const HOST_LEASE_MS = 3_000;
export const MAX_FILE_BYTES = 128 * 1024;
export const MAX_TRANSFER_BYTES = 128 * 1024;

export type JobInput = {
  rules: CounterRules;
  files: { path: string; bytes: number[] }[];
  trap?: boolean;
  slowCall?: boolean;
  blockMs?: number;
};
export type JobOutcome =
  | { state: "completed"; result: AnalysisResultV1 }
  | {
      state: "failed";
      error: "counter_failed" | "invalid_input" | "deadline_exceeded";
    }
  | { state: "canceled" }
  | { state: "interrupted" };

export function validInput(value: unknown): value is JobInput {
  if (typeof value !== "object" || value === null) return false;
  const input = value as Partial<JobInput>;
  if (
    !input.rules ||
    typeof input.rules.repositoryId !== "string" ||
    typeof input.rules.commitSha !== "string" ||
    !Array.isArray(input.files) ||
    input.files.length > 100 ||
    (input.trap !== undefined && typeof input.trap !== "boolean") ||
    (input.slowCall !== undefined && typeof input.slowCall !== "boolean")
  )
    return false;
  if (
    input.blockMs !== undefined &&
    (!Number.isInteger(input.blockMs) ||
      input.blockMs < 0 ||
      input.blockMs > 10_000)
  )
    return false;
  let bytes = 0;
  for (const file of input.files) {
    if (
      !file ||
      typeof file.path !== "string" ||
      new TextEncoder().encode(file.path).length > 4096 ||
      !Array.isArray(file.bytes) ||
      file.bytes.length > MAX_FILE_BYTES ||
      !file.bytes.every((n) => Number.isInteger(n) && n >= 0 && n <= 255)
    )
      return false;
    bytes += file.bytes.length;
    if (bytes > MAX_TRANSFER_BYTES) return false;
  }
  return true;
}
