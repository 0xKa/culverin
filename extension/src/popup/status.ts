import type {
  PublicErrorCode,
  ResolutionEnvelope,
} from "../github/public-protocol";
import type { StatusMark, StatusTone } from "../ui/badge";

export type PopupStatus = {
  label: string;
  tone: StatusTone;
  mark: StatusMark;
  detail: string;
  note?: string;
};

function status(
  label: string,
  tone: StatusTone,
  mark: StatusMark,
  detail: string,
): PopupStatus {
  return { label, tone, mark, detail };
}

export const statuses = {
  notRepository: status(
    "Not a repo",
    "neutral",
    "idle",
    "Open a GitHub repository overview to analyze it.",
  ),
  tabChanged: status(
    "Tab changed",
    "neutral",
    "idle",
    "The active tab changed. Reopen the popup to analyze it.",
  ),
  tabUnreadable: status(
    "Unavailable",
    "neutral",
    "failed",
    "Unable to read the active tab. Open a GitHub repository.",
  ),
  extensionUnavailable: status(
    "Unavailable",
    "error",
    "failed",
    "Extension unavailable. Reopen the popup to retry.",
  ),
  lookup: status("Checking", "accent", "busy", "Checking saved results…"),
  lookupTimeout: status(
    "Timed out",
    "error",
    "failed",
    "GitHub did not respond in time. Reopen the popup to retry.",
  ),
  notCounted: status(
    "Not counted",
    "neutral",
    "idle",
    "Analyze checks GitHub and counts the source locally.",
  ),
  rulesChanged: status(
    "Rules changed",
    "warning",
    "idle",
    "Culverin ignore changed. Reopen the popup to see results for the current rules.",
  ),
  cached: status(
    "Cached",
    "neutral",
    "saved",
    "Cached local analysis, checked on GitHub in the last 20 minutes. Select Reanalyze to check for a newer commit.",
  ),
  upToDate: status(
    "Up to date",
    "ok",
    "done",
    "No new commit since the last analysis. Showing the cached result.",
  ),
  fresh: status("Fresh", "ok", "done", "Analyzed locally."),
  partial: status("Partial", "warning", "done", "Partial local analysis."),
  resolving: status("Checking", "accent", "busy", "Resolving default branch…"),
  checkingUpdates: status(
    "Checking",
    "accent",
    "busy",
    "Checking for updates…",
  ),
  running: status(
    "Counting",
    "accent",
    "busy",
    "Analysis in progress. Closing the popup does not stop it.",
  ),
};

export const progressStatuses = {
  queued: status("Queued", "neutral", "idle", "Queued for local analysis…"),
  resolving: status(
    "Checking",
    "accent",
    "busy",
    "Resolving repository revision…",
  ),
  downloading: status(
    "Downloading",
    "accent",
    "busy",
    "Downloading source snapshot from GitHub…",
  ),
  decompressing: status(
    "Unpacking",
    "accent",
    "busy",
    "Decompressing and validating source snapshot…",
  ),
  counting: status(
    "Counting",
    "accent",
    "busy",
    "Counting source files locally…",
  ),
};

export function readyStatus(
  resolution: ResolutionEnvelope,
  rulesChanged: boolean,
): PopupStatus {
  const detail = `Ready to analyze ${resolution.defaultBranch} at ${resolution.sha.slice(0, 12)}. ${rulesChanged ? "Culverin ignore changed since the last count." : "Analyze downloads a source snapshot from GitHub and counts it locally."}`;
  return rulesChanged
    ? status("Rules changed", "warning", "idle", detail)
    : status("Not counted", "neutral", "idle", detail);
}

const failures: Record<PublicErrorCode, [string, StatusTone]> = {
  invalid_repository: ["Not a repo", "neutral"],
  unsupported_page: ["Not a repo", "neutral"],
  repository_unavailable: ["Unavailable", "error"],
  repository_empty: ["Empty", "neutral"],
  repository_forbidden: ["Unavailable", "error"],
  rate_limited: ["Rate limited", "error"],
  archive_throttled: ["GitHub busy", "warning"],
  authentication_required: ["No access", "warning"],
  authentication_invalid: ["Expired", "warning"],
  access_not_granted: ["No access", "warning"],
  metadata_limit_exceeded: ["Too large", "error"],
  network_unavailable: ["Unreachable", "error"],
  download_failed: ["Failed", "error"],
  compressed_limit_exceeded: ["Too large", "error"],
  decompressed_limit_exceeded: ["Too large", "error"],
  entry_limit_exceeded: ["Too large", "error"],
  file_limit_exceeded: ["Too large", "error"],
  archive_invalid: ["Unreadable", "error"],
  archive_unsupported: ["Unsupported", "error"],
  analysis_timeout: ["Timed out", "error"],
  analysis_interrupted: ["Interrupted", "warning"],
  analysis_busy: ["Busy", "warning"],
  analysis_canceled: ["Canceled", "neutral"],
  counter_failed: ["Failed", "error"],
  internal_error: ["Failed", "error"],
};

export function failureStatus(
  code: PublicErrorCode,
  detail: string,
  note?: string,
): PopupStatus {
  const [label, tone] = failures[code];
  return {
    ...status(label, tone, "failed", detail),
    ...(note ? { note } : {}),
  };
}
