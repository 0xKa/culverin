import type { PublicErrorCode } from "./public-protocol";

export const failureMessages: Record<PublicErrorCode, string> = {
  invalid_repository: "Invalid repository address.",
  unsupported_page: "This page is not supported.",
  repository_unavailable:
    "Repository unavailable, or your GitHub connection can't access it. Check which repositories Culverin can read in its settings.",
  repository_empty: "This repository has no default-branch commit to analyze.",
  repository_forbidden:
    "Repository unavailable, or your GitHub connection can't access it. Check which repositories Culverin can read in its settings.",
  rate_limited: "GitHub rate limit reached.",
  authentication_required:
    "This repository is private or doesn't exist. Connect GitHub in Culverin's settings to count private repositories.",
  authentication_invalid:
    "Your GitHub connection has expired. Connect again in Culverin's settings.",
  metadata_limit_exceeded: "Repository metadata exceeds the safe limit.",
  network_unavailable: "GitHub could not be reached.",
  download_failed: "The source snapshot could not be downloaded.",
  compressed_limit_exceeded:
    "The source snapshot exceeds the compressed-size limit.",
  decompressed_limit_exceeded:
    "The source snapshot exceeds the expanded-size limit.",
  entry_limit_exceeded: "The source snapshot has too many entries.",
  file_limit_exceeded: "The source snapshot has too many files.",
  archive_invalid: "The source snapshot is malformed.",
  archive_unsupported: "This source snapshot format is unsupported.",
  analysis_timeout: "Analysis timed out. Try again.",
  analysis_interrupted: "Analysis was interrupted. Try again.",
  analysis_busy: "Analysis is busy. Try again shortly.",
  analysis_canceled: "Analysis canceled.",
  counter_failed: "Local counting failed.",
  internal_error: "Analysis failed. Try again.",
};
