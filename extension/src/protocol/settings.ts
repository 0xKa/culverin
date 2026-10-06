import type { ConnectionStatus } from "../auth/connection";
import { validateResult } from "../counter/result";
import type { AnalysisOutput } from "../github/coordinator";
import {
  validEnvelope,
  validFailureDetails,
  type PublicErrorCode,
  type ResolutionEnvelope,
} from "../github/public-protocol";
import { validLogin, validRepository } from "../github/repository";

export type SettingsEnvelope = {
  protocolVersion: 1;
  requestId: string;
  navigationId: string;
};
export type SettingsCommand =
  | {
      type:
        | "auth.status"
        | "auth.device.start"
        | "auth.device.poll"
        | "auth.device.cancel"
        | "auth.disconnect"
        | "auth.clear-private-session"
        | "cache.clear-public"
        | "cache.clear-all"
        | "analysis.status"
        | "rate-limit.check";
    }
  | { type: "auth.submit"; submissionId: string }
  | {
      type: "repository.lookup" | "analysis.request";
      owner: string;
      name: string;
    }
  | { type: "analysis.cancel"; targetRequestId: string }
  | { type: "cache.delete"; scope: "public" | "private"; identity: string };
export type SettingsRequest = SettingsEnvelope & SettingsCommand;
export type DeviceView = {
  userCode: string;
  verificationUri: string;
  expiresAt: number;
  interval: number;
};
export type SettingsStatus = ConnectionStatus & { device?: DeviceView };
export type SettingsPayload =
  | ({ state: "ok" | "connected" } & SettingsStatus)
  | { state: "pending"; retryIn: number }
  | { state: "disconnected" | "cleared"; generation: string }
  | {
      state:
        | "device-expired"
        | "device-missing"
        | "device-denied"
        | "stale"
        | "public-cache-cleared"
        | "all-results-cleared"
        | "result-deleted"
        | "canceled"
        | "idle"
        | "queued"
        | "running"
        | "interrupted"
        | "busy"
        | "checked";
    }
  | { state: "failed"; code: PublicErrorCode; retryAt?: number; limit?: string }
  | { state: "resolved"; resolution: ResolutionEnvelope }
  | ({ state: "analyzed"; resolution: ResolutionEnvelope } & AnalysisOutput);
export type SettingsReply = SettingsEnvelope & SettingsPayload;

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function exact(
  value: Record<string, unknown>,
  required: string[],
  optional: string[] = [],
): boolean {
  return (
    required.every((key) => key in value) &&
    Object.keys(value).every(
      (key) => required.includes(key) || optional.includes(key),
    )
  );
}
export function validSettingsId(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f-]{36}$/.test(value);
}
export function validSettingsRequest(value: unknown): value is SettingsRequest {
  if (
    !record(value) ||
    value.protocolVersion !== 1 ||
    !validSettingsId(value.requestId) ||
    !validSettingsId(value.navigationId)
  )
    return false;
  const fields = ["protocolVersion", "requestId", "navigationId", "type"];
  switch (value.type) {
    case "auth.submit":
      return (
        exact(value, [...fields, "submissionId"]) &&
        validSettingsId(value.submissionId)
      );
    case "repository.lookup":
    case "analysis.request":
      return (
        exact(value, [...fields, "owner", "name"]) &&
        typeof value.owner === "string" &&
        typeof value.name === "string" &&
        validRepository(value.owner, value.name)
      );
    case "analysis.cancel":
      return (
        exact(value, [...fields, "targetRequestId"]) &&
        validSettingsId(value.targetRequestId)
      );
    case "cache.delete":
      return (
        exact(value, [...fields, "scope", "identity"]) &&
        (value.scope === "public" || value.scope === "private") &&
        typeof value.identity === "string" &&
        value.identity.length > 0 &&
        value.identity.length <= 1024
      );
    case "auth.status":
    case "auth.device.start":
    case "auth.device.poll":
    case "auth.device.cancel":
    case "auth.disconnect":
    case "auth.clear-private-session":
    case "cache.clear-public":
    case "cache.clear-all":
    case "analysis.status":
    case "rate-limit.check":
      return exact(value, fields);
    default:
      return false;
  }
}
function positive(value: unknown): boolean {
  return Number.isSafeInteger(value) && (value as number) > 0;
}
function nonnegative(value: unknown): boolean {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}
function validDevice(value: unknown): boolean {
  return (
    record(value) &&
    exact(value, ["userCode", "verificationUri", "expiresAt", "interval"]) &&
    typeof value.userCode === "string" &&
    /^[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(value.userCode) &&
    value.verificationUri === "https://github.com/login/device" &&
    positive(value.expiresAt) &&
    positive(value.interval)
  );
}
export function validSettingsReply(
  value: unknown,
  requestId: string,
  navigationId: string,
): value is SettingsReply {
  if (
    !record(value) ||
    value.protocolVersion !== 1 ||
    value.requestId !== requestId ||
    value.navigationId !== navigationId ||
    !validSettingsId(requestId) ||
    !validSettingsId(navigationId)
  )
    return false;
  const fields = ["protocolVersion", "requestId", "navigationId", "state"];
  switch (value.state) {
    case "ok":
    case "connected":
      return (
        exact(
          value,
          [...fields, "generation", "connected", "expired"],
          ["method", "login", "device"],
        ) &&
        validSettingsId(value.generation) &&
        typeof value.connected === "boolean" &&
        typeof value.expired === "boolean" &&
        (value.state !== "connected" || value.connected) &&
        (value.method === undefined ||
          value.method === "app" ||
          value.method === "token") &&
        (value.login === undefined ||
          (typeof value.login === "string" && validLogin(value.login))) &&
        (value.method === undefined) === (value.login === undefined) &&
        (!value.connected ||
          (value.method !== undefined &&
            value.login !== undefined &&
            !value.expired)) &&
        (value.device === undefined || validDevice(value.device))
      );
    case "pending":
      return exact(value, [...fields, "retryIn"]) && positive(value.retryIn);
    case "disconnected":
    case "cleared":
      return (
        exact(value, [...fields, "generation"]) &&
        validSettingsId(value.generation)
      );
    case "failed":
      return (
        exact(value, [...fields, "code"], ["retryAt", "limit"]) &&
        validFailureDetails(value)
      );
    case "resolved":
      return (
        exact(value, [...fields, "resolution"]) &&
        validEnvelope(value.resolution)
      );
    case "analyzed": {
      if (
        !exact(value, [
          ...fields,
          "resolution",
          "result",
          "transport",
          "wasmLinearMemoryBytes",
        ]) ||
        !validEnvelope(value.resolution) ||
        !record(value.transport) ||
        !exact(
          value.transport,
          ["compressedBytes", "decompressedBytes"],
          [
            "entries",
            "regularFiles",
            "specialEntries",
            "wasmBytes",
            "retainedPathBytes",
          ],
        ) ||
        !nonnegative(value.transport.compressedBytes) ||
        !nonnegative(value.transport.decompressedBytes) ||
        !Object.values(value.transport).every(nonnegative) ||
        !nonnegative(value.wasmLinearMemoryBytes)
      )
        return false;
      return (
        validateResult(value.result) &&
        value.result.repository.id === value.resolution.repositoryId &&
        value.result.revision.commitSha === value.resolution.sha
      );
    }
    case "device-expired":
    case "device-missing":
    case "device-denied":
    case "stale":
    case "public-cache-cleared":
    case "all-results-cleared":
    case "result-deleted":
    case "canceled":
    case "idle":
    case "queued":
    case "running":
    case "interrupted":
    case "busy":
    case "checked":
      return exact(value, fields);
    default:
      return false;
  }
}
