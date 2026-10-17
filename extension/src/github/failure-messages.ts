import { ARCHIVE_LIMITS, DOWNLOAD_LIMITS } from "../archive/limits";
import { limitSize } from "../ui/format";
import type { PublicErrorCode } from "./public-protocol";

const count = (value: number) => value.toLocaleString("en");

const limitNotes: Record<string, string> = {
  compressed: `${limitSize(ARCHIVE_LIMITS.compressed)} downloaded`,
  decompressed: `${limitSize(ARCHIVE_LIMITS.decompressed)} unpacked`,
  entries: `${count(ARCHIVE_LIMITS.entries)} archive entries`,
  regularFiles: `${count(ARCHIVE_LIMITS.regularFiles)} files`,
  paxBody: `${count(ARCHIVE_LIMITS.paxBody / 1024)} KiB of metadata for one entry`,
  paxTotal: `${limitSize(ARCHIVE_LIMITS.paxTotal)} of archive metadata`,
  retainedPaths: `${limitSize(ARCHIVE_LIMITS.retainedPaths)} of file paths`,
};

const sizedNotes: Record<string, (bytes: number) => string> = {
  compressed: (bytes) => `${limitSize(bytes)} downloaded`,
  decompressed: (bytes) => `${limitSize(bytes)} unpacked`,
};

const raisable: Record<string, { fallback: number; maximum: number }> = {
  compressed: {
    fallback: ARCHIVE_LIMITS.compressed,
    maximum: DOWNLOAD_LIMITS.maximum,
  },
  decompressed: {
    fallback: ARCHIVE_LIMITS.decompressed,
    maximum: DOWNLOAD_LIMITS.maximum * DOWNLOAD_LIMITS.unpackedRatio,
  },
};

export function limitNote(limit?: string, limitBytes?: number): string {
  if (limit === undefined) return "";
  const note =
    limitBytes !== undefined && sizedNotes[limit]
      ? sizedNotes[limit](limitBytes)
      : limitNotes[limit];
  if (!note) return "";
  const range = raisable[limit];
  const raise =
    range && (limitBytes ?? range.fallback) < range.maximum
      ? " You can raise it in Settings → Large repositories."
      : "";
  return ` The limit is ${note}.${raise}`;
}

export const failureMessages: Record<PublicErrorCode, string> = {
  invalid_repository: "Invalid repository address.",
  unsupported_page: "This page is not supported.",
  repository_unavailable: "Repository unavailable or access is restricted.",
  repository_empty: "This repository has no default-branch commit to analyze.",
  repository_forbidden: "Repository unavailable or access is restricted.",
  ref_unavailable:
    "This branch, tag, or commit wasn't found on GitHub. It may have been deleted or renamed.",
  rate_limited: "GitHub rate limit reached.",
  archive_throttled:
    "GitHub is busy preparing this repository's source snapshot. Try again in a minute.",
  authentication_required:
    "This repository is private or doesn't exist. Connect GitHub in Culverin's settings to count private repositories.",
  authentication_invalid:
    "Your GitHub connection has expired. Connect again in Culverin's settings.",
  access_not_granted:
    "Your GitHub connection can't read this repository. If it's private, give Culverin access to it from the GitHub section of its settings.",
  metadata_limit_exceeded: "Repository metadata exceeds the safe limit.",
  network_unavailable: "GitHub could not be reached.",
  download_failed: "The source snapshot could not be downloaded.",
  compressed_limit_exceeded:
    "The source snapshot exceeds the compressed-size limit.",
  decompressed_limit_exceeded:
    "The source snapshot exceeds the expanded-size limit.",
  entry_limit_exceeded: "The source snapshot has too many entries.",
  file_limit_exceeded: "The source snapshot exceeds the counting limit.",
  auto_download_limit: "Too large to count automatically.",
  archive_invalid: "The source snapshot is malformed.",
  archive_unsupported: "This source snapshot format is unsupported.",
  analysis_timeout: "Analysis timed out. Try again.",
  analysis_interrupted: "Analysis was interrupted. Try again.",
  analysis_busy: "Analysis is busy. Try again shortly.",
  analysis_canceled: "Analysis canceled.",
  counter_failed: "Local counting failed.",
  internal_error: "Analysis failed. Try again.",
};

export function failureDetail(
  code: PublicErrorCode,
  limit?: string,
  limitBytes?: number,
): string {
  if (code === "auto_download_limit")
    return `${failureMessages[code]}${limitBytes ? ` Click to count up to ${limitSize(limitBytes)}.` : ""}`;
  return failureMessages[code] + limitNote(limit, limitBytes);
}
