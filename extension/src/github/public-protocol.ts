import { validateResult, type AnalysisResultV2 } from "../counter/result";
import { validRepository, type Resolution } from "./client";

export const PUBLIC_VERSION = 1;
export const PUBLIC_PORT = "culverin.public";
export const POPUP_PORT = "culverin.popup";

export type PublicRequest = {
  protocolVersion: 1;
  type:
    | "repository.lookup"
    | "analysis.request"
    | "analysis.cancel"
    | "analysis.status"
    | "popup.open";
  requestId: string;
  navigationId: string;
  repository?: { owner: string; name: string };
  targetRequestId?: string;
};

export type PopupPublicRequest = PublicRequest & { tabId: number };

export type SummaryUpdate = {
  protocolVersion: 1;
  type: "summary.update";
  repository: { owner: string; name: string };
  totalCodeLines: number;
  customIgnore: boolean;
};

export type ResolutionEnvelope = Resolution & { resolvedAt: number };
export type PublicErrorCode =
  | "invalid_repository"
  | "unsupported_page"
  | "repository_unavailable"
  | "repository_empty"
  | "repository_forbidden"
  | "rate_limited"
  | "authentication_required"
  | "authentication_invalid"
  | "metadata_limit_exceeded"
  | "network_unavailable"
  | "download_failed"
  | "compressed_limit_exceeded"
  | "decompressed_limit_exceeded"
  | "entry_limit_exceeded"
  | "file_limit_exceeded"
  | "archive_invalid"
  | "archive_unsupported"
  | "analysis_timeout"
  | "analysis_interrupted"
  | "analysis_busy"
  | "analysis_canceled"
  | "counter_failed"
  | "internal_error";

export type PublicReply = {
  protocolVersion: 1;
  requestId: string;
  navigationId: string;
} & (
  | {
      type: "repository.cache_miss";
      resolution: ResolutionEnvelope;
      rulesChanged?: true;
      autoCount?: true;
    }
  | { type: "repository.not_cached" }
  | {
      type: "repository.cache_hit";
      resolution: ResolutionEnvelope;
      result: AnalysisResultV2;
    }
  | {
      type: "analysis.completed";
      resolution: ResolutionEnvelope;
      result: AnalysisResultV2;
      fromCache: boolean;
    }
  | {
      type: "analysis.failed";
      code: PublicErrorCode;
      retryAt?: number;
      limit?: string;
    }
  | { type: "analysis.canceled"; targetRequestId: string }
  | {
      type: "analysis.status";
      state: "idle" | "queued" | "running" | "interrupted";
    }
  | { type: "popup.opened"; opened: boolean }
  | {
      type: "analysis.progress";
      phase:
        "queued" | "resolving" | "downloading" | "decompressing" | "counting";
      processedBytes?: number;
    }
);

type WithoutCorrelation<T> = T extends unknown
  ? Omit<T, "protocolVersion" | "requestId" | "navigationId">
  : never;
export type PublicPayload = WithoutCorrelation<PublicReply>;

const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const exact = (value: Record<string, unknown>, keys: string[]) =>
  Object.keys(value).sort().join("|") === keys.sort().join("|");
export const validId = (value: unknown): value is string =>
  typeof value === "string" &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );

export function validPublicRequest(value: unknown): value is PublicRequest {
  if (!record(value) || value.protocolVersion !== PUBLIC_VERSION) return false;
  if (!validId(value.requestId) || !validId(value.navigationId)) return false;
  if (value.type === "repository.lookup" || value.type === "analysis.request") {
    if (
      !exact(value, [
        "protocolVersion",
        "type",
        "requestId",
        "navigationId",
        "repository",
      ]) ||
      !record(value.repository)
    )
      return false;
    const repository = value.repository;
    return (
      exact(repository, ["owner", "name"]) &&
      typeof repository.owner === "string" &&
      typeof repository.name === "string" &&
      validRepository(repository.owner, repository.name)
    );
  }
  if (value.type === "analysis.cancel")
    return (
      exact(value, [
        "protocolVersion",
        "type",
        "requestId",
        "navigationId",
        "targetRequestId",
      ]) && validId(value.targetRequestId)
    );
  return (
    (value.type === "analysis.status" || value.type === "popup.open") &&
    exact(value, ["protocolVersion", "type", "requestId", "navigationId"])
  );
}

export function validPopupPublicRequest(
  value: unknown,
): value is PopupPublicRequest {
  if (
    !record(value) ||
    typeof value.tabId !== "number" ||
    !Number.isSafeInteger(value.tabId) ||
    value.tabId < 0
  )
    return false;
  const request = { ...value };
  delete request.tabId;
  return validPublicRequest(request) && request.type !== "popup.open";
}

export function validSummaryUpdate(value: unknown): value is SummaryUpdate {
  if (
    !record(value) ||
    !exact(value, [
      "protocolVersion",
      "type",
      "repository",
      "totalCodeLines",
      "customIgnore",
    ]) ||
    value.protocolVersion !== PUBLIC_VERSION ||
    value.type !== "summary.update" ||
    !record(value.repository) ||
    !exact(value.repository, ["owner", "name"]) ||
    typeof value.repository.owner !== "string" ||
    typeof value.repository.name !== "string" ||
    !validRepository(value.repository.owner, value.repository.name)
  )
    return false;
  return (
    Number.isSafeInteger(value.totalCodeLines) &&
    (value.totalCodeLines as number) >= 0 &&
    typeof value.customIgnore === "boolean"
  );
}

export function validEnvelope(value: unknown): value is ResolutionEnvelope {
  if (
    !record(value) ||
    !exact(value, [
      "repositoryId",
      "owner",
      "name",
      "defaultBranch",
      "visibility",
      "sha",
      "sizeKb",
      "resolvedAt",
    ])
  )
    return false;
  return (
    typeof value.repositoryId === "string" &&
    /^[1-9][0-9]*$/.test(value.repositoryId) &&
    typeof value.owner === "string" &&
    typeof value.name === "string" &&
    validRepository(value.owner, value.name) &&
    typeof value.defaultBranch === "string" &&
    value.defaultBranch.length > 0 &&
    value.defaultBranch.length <= 255 &&
    (value.visibility === "public" || value.visibility === "private") &&
    typeof value.sha === "string" &&
    /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(value.sha) &&
    (value.sizeKb === null ||
      (Number.isSafeInteger(value.sizeKb) && (value.sizeKb as number) >= 0)) &&
    Number.isSafeInteger(value.resolvedAt) &&
    (value.resolvedAt as number) > 0 &&
    (value.resolvedAt as number) <= Date.now() + 60_000
  );
}

const codes: PublicErrorCode[] = [
  "invalid_repository",
  "unsupported_page",
  "repository_unavailable",
  "repository_empty",
  "repository_forbidden",
  "rate_limited",
  "authentication_required",
  "authentication_invalid",
  "metadata_limit_exceeded",
  "network_unavailable",
  "download_failed",
  "compressed_limit_exceeded",
  "decompressed_limit_exceeded",
  "entry_limit_exceeded",
  "file_limit_exceeded",
  "archive_invalid",
  "archive_unsupported",
  "analysis_timeout",
  "analysis_interrupted",
  "analysis_busy",
  "analysis_canceled",
  "counter_failed",
  "internal_error",
];

export function publicFailure(
  code: unknown,
  retryAt?: unknown,
  limit?: unknown,
): Pick<
  Extract<PublicReply, { type: "analysis.failed" }>,
  "code" | "retryAt" | "limit"
> {
  return {
    code: codes.includes(code as PublicErrorCode)
      ? (code as PublicErrorCode)
      : "internal_error",
    ...(Number.isSafeInteger(retryAt) &&
    (retryAt as number) > 0 &&
    (retryAt as number) < Date.now() + 7 * 24 * 60 * 60 * 1000
      ? { retryAt: retryAt as number }
      : {}),
    ...(typeof limit === "string" && /^[A-Za-z][A-Za-z0-9]{0,40}$/.test(limit)
      ? { limit }
      : {}),
  };
}

export function validPublicReply(
  value: unknown,
  requestId: string,
  navigationId: string,
): value is PublicReply {
  if (
    !record(value) ||
    value.protocolVersion !== 1 ||
    value.requestId !== requestId ||
    value.navigationId !== navigationId
  )
    return false;
  const base = ["protocolVersion", "type", "requestId", "navigationId"];
  if (value.type === "repository.cache_miss")
    return (
      exact(value, [
        ...base,
        "resolution",
        ...(value.rulesChanged === undefined ? [] : ["rulesChanged"]),
        ...(value.autoCount === undefined ? [] : ["autoCount"]),
      ]) &&
      (value.rulesChanged === undefined || value.rulesChanged === true) &&
      (value.autoCount === undefined || value.autoCount === true) &&
      validEnvelope(value.resolution) &&
      value.resolution.visibility === "public"
    );
  if (value.type === "repository.not_cached") return exact(value, base);
  if (
    value.type === "repository.cache_hit" ||
    value.type === "analysis.completed"
  )
    return (
      exact(value, [
        ...base,
        "resolution",
        "result",
        ...(value.type === "analysis.completed" ? ["fromCache"] : []),
      ]) &&
      (value.type !== "analysis.completed" ||
        typeof value.fromCache === "boolean") &&
      validEnvelope(value.resolution) &&
      value.resolution.visibility === "public" &&
      validateResult(value.result) &&
      (value.type === "analysis.completed" && value.fromCache === false
        ? true
        : value.result.coverage.complete) &&
      value.result.repository.id === value.resolution.repositoryId &&
      value.result.revision.commitSha === value.resolution.sha
    );
  if (value.type === "analysis.failed")
    return (
      exact(value, [
        ...base,
        "code",
        ...(value.retryAt === undefined ? [] : ["retryAt"]),
        ...(value.limit === undefined ? [] : ["limit"]),
      ]) &&
      codes.includes(value.code as PublicErrorCode) &&
      (value.retryAt === undefined ||
        (Number.isSafeInteger(value.retryAt) &&
          (value.retryAt as number) > 0)) &&
      (value.limit === undefined ||
        (typeof value.limit === "string" &&
          /^[A-Za-z][A-Za-z0-9]{0,40}$/.test(value.limit)))
    );
  if (value.type === "analysis.canceled")
    return (
      exact(value, [...base, "targetRequestId"]) &&
      validId(value.targetRequestId)
    );
  if (value.type === "analysis.status")
    return (
      exact(value, [...base, "state"]) &&
      ["idle", "queued", "running", "interrupted"].includes(
        value.state as string,
      )
    );
  if (value.type === "popup.opened")
    return (
      exact(value, [...base, "opened"]) && typeof value.opened === "boolean"
    );
  if (value.type === "analysis.progress")
    return (
      exact(value, [
        ...base,
        "phase",
        ...(value.processedBytes === undefined ? [] : ["processedBytes"]),
      ]) &&
      [
        "queued",
        "resolving",
        "downloading",
        "decompressing",
        "counting",
      ].includes(value.phase as string) &&
      (value.processedBytes === undefined ||
        (Number.isSafeInteger(value.processedBytes) &&
          (value.processedBytes as number) >= 0 &&
          (value.processedBytes as number) <= 50 * 1024 * 1024))
    );
  return false;
}
