import {
  refPrefixes,
  validLogin,
  validRepository,
  REF_LIMIT,
  type RefTarget,
} from "./repository";
import { ARCHIVE_LIMITS } from "../archive/limits";
import { readRateLimit, readRateLimitBody, type RateLimit } from "./rate-limit";

export const API_VERSION = "2026-03-10";
export const METADATA_LIMIT = 1024 * 1024;
export const ARCHIVE_LIMIT = ARCHIVE_LIMITS.compressed;
export type Fetcher = (input: string, init: RequestInit) => Promise<Response>;

export type Resolution = {
  repositoryId: string;
  owner: string;
  name: string;
  defaultBranch: string;
  visibility: "public" | "private";
  sha: string;
  sizeKb: number | null;
  ref?: string;
};

export type RefResolution = Resolution & { nested?: boolean };
type RefObjects = Map<string, Record<string, unknown> | undefined>;

const REF_ATTEMPTS = 5;

export type AcquisitionErrorCode =
  | "invalid_repository"
  | "metadata_limit_exceeded"
  | "repository_unavailable"
  | "repository_empty"
  | "ref_unavailable"
  | "authentication_invalid"
  | "repository_forbidden"
  | "rate_limited"
  | "archive_throttled"
  | "network_unavailable"
  | "download_failed"
  | "compressed_limit_exceeded"
  | "analysis_timeout"
  | "analysis_canceled";

export class AcquisitionError extends Error {
  constructor(
    readonly code: AcquisitionErrorCode,
    readonly retryAt?: number,
  ) {
    super(code);
  }
}

function apiUrl(owner: string, name: string, suffix = ""): string {
  if (!validRepository(owner, name))
    throw new AcquisitionError("invalid_repository");
  return `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}${suffix}`;
}

function headers(token?: string): Headers {
  const result = new Headers({
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": API_VERSION,
  });
  if (token) result.set("Authorization", `Bearer ${token}`);
  return result;
}

function apiFailure(response: Response): AcquisitionError {
  const remaining = response.headers.get("x-ratelimit-remaining");
  const reset = Number(response.headers.get("x-ratelimit-reset"));
  const retryAfter = Number(response.headers.get("retry-after"));
  if (
    (response.status === 403 || response.status === 429) &&
    (remaining === "0" ||
      response.status === 429 ||
      response.headers.has("retry-after"))
  ) {
    const retryAt =
      Number.isFinite(retryAfter) && retryAfter > 0
        ? Date.now() + retryAfter * 1000
        : remaining === "0" && Number.isFinite(reset) && reset > 0
          ? reset * 1000
          : undefined;
    return new AcquisitionError("rate_limited", retryAt);
  }
  if (response.status === 401)
    return new AcquisitionError("authentication_invalid");
  if (response.status === 404)
    return new AcquisitionError("repository_unavailable");
  if (response.status === 403)
    return new AcquisitionError("repository_forbidden");
  return new AcquisitionError("network_unavailable");
}

export function trustedOrigin(response: Response, origin: string): boolean {
  try {
    const url = new URL(response.url);
    return url.origin === origin && url.username === "" && url.password === "";
  } catch {
    return false;
  }
}

export async function boundedJson(response: Response): Promise<unknown> {
  const length = Number(response.headers.get("content-length"));
  if (Number.isFinite(length) && length > METADATA_LIMIT) {
    await response.body?.cancel().catch(() => undefined);
    throw new AcquisitionError("metadata_limit_exceeded");
  }
  if (!response.body) throw new AcquisitionError("network_unavailable");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > METADATA_LIMIT)
        throw new AcquisitionError("metadata_limit_exceeded");
      chunks.push(value);
    }
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    throw error;
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    throw new AcquisitionError("network_unavailable");
  }
}

async function apiRequest(
  fetcher: Fetcher,
  url: string,
  token: string | undefined,
  signal: AbortSignal,
): Promise<Response> {
  const response = await fetcher(url, {
    method: "GET",
    headers: headers(token),
    cache: "no-store",
    credentials: "omit",
    redirect: "follow",
    signal,
  });
  if (!trustedOrigin(response, "https://api.github.com")) {
    await response.body?.cancel().catch(() => undefined);
    throw new AcquisitionError("network_unavailable");
  }
  return response;
}

async function apiResponse(
  fetcher: Fetcher,
  url: string,
  token: string | undefined,
  signal: AbortSignal,
): Promise<Response> {
  const response = await apiRequest(fetcher, url, token, signal);
  if (!response.ok) throw apiFailure(response);
  return response;
}

async function apiGet(
  fetcher: Fetcher,
  url: string,
  token: string | undefined,
  signal: AbortSignal,
): Promise<unknown> {
  return boundedJson(await apiResponse(fetcher, url, token, signal));
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

export async function fetchLogin(
  fetcher: Fetcher,
  token: string,
  signal: AbortSignal,
): Promise<string> {
  const login = record(
    await apiGet(fetcher, "https://api.github.com/user", token, signal),
  )?.login;
  if (typeof login !== "string" || !validLogin(login))
    throw new AcquisitionError("network_unavailable");
  return login;
}

export async function fetchRateLimit(
  fetcher: Fetcher,
  token: string | undefined,
  signal: AbortSignal,
): Promise<RateLimit> {
  let value: RateLimit | undefined;
  if (token === undefined)
    value = readRateLimitBody(
      await apiGet(
        fetcher,
        "https://api.github.com/rate_limit",
        undefined,
        signal,
      ),
    );
  else {
    const response = await apiResponse(
      fetcher,
      "https://api.github.com/user",
      token,
      signal,
    );
    await response.body?.cancel().catch(() => undefined);
    value = readRateLimit(response.headers, true);
  }
  if (!value) throw new AcquisitionError("network_unavailable");
  return value;
}

export async function resolveRepository(
  fetcher: Fetcher,
  owner: string,
  name: string,
  token: string | undefined,
  signal: AbortSignal,
  target?: RefTarget,
): Promise<RefResolution> {
  const metadata = record(
    await apiGet(fetcher, apiUrl(owner, name), token, signal),
  );
  const canonicalOwner = record(metadata?.owner)?.login;
  const canonicalName = metadata?.name;
  const id = metadata?.id;
  const branch = metadata?.default_branch;
  const size = metadata?.size;
  const visibility =
    metadata?.private === true
      ? "private"
      : metadata?.private === false
        ? "public"
        : undefined;
  if (
    typeof canonicalOwner !== "string" ||
    typeof canonicalName !== "string" ||
    !validRepository(canonicalOwner, canonicalName) ||
    !(typeof id === "number" && Number.isSafeInteger(id) && id > 0) ||
    !visibility
  )
    throw new AcquisitionError("network_unavailable");
  if (branch === null || branch === "")
    throw new AcquisitionError("repository_empty");
  if (typeof branch !== "string" || branch.length > 255)
    throw new AcquisitionError("network_unavailable");
  const commitUrl = (ref: string) =>
    apiUrl(
      canonicalOwner,
      canonicalName,
      `/commits/${encodeURIComponent(ref)}`,
    );
  const shaOf = (value: unknown) => {
    const sha = record(value)?.sha;
    if (
      typeof sha !== "string" ||
      !/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/i.test(sha)
    )
      throw new AcquisitionError("network_unavailable");
    return sha.toLowerCase();
  };
  const listRefs = async (kind: "heads" | "tags", prefix: string) => {
    const value = await apiGet(
      fetcher,
      apiUrl(
        canonicalOwner,
        canonicalName,
        `/git/matching-refs/${kind}/${prefix.split("/").map(encodeURIComponent).join("/")}`,
      ),
      token,
      signal,
    );
    if (!Array.isArray(value))
      throw new AcquisitionError("network_unavailable");
    const refs: RefObjects = new Map();
    for (const item of value) {
      const name = record(item)?.ref;
      if (typeof name === "string" && name.startsWith(`refs/${kind}/`))
        refs.set(
          name.slice(`refs/${kind}/`.length),
          record(record(item)?.object),
        );
    }
    return refs;
  };
  const commitOf = async (candidate: string) => {
    const response = await apiRequest(
      fetcher,
      commitUrl(candidate),
      token,
      signal,
    );
    if (response.status === 404 || response.status === 422) {
      await response.body?.cancel().catch(() => undefined);
      return undefined;
    }
    if (!response.ok) throw apiFailure(response);
    return shaOf(await boundedJson(response));
  };
  let ref: string | undefined;
  let sha: string | undefined;
  let nested: boolean | undefined;
  if (target && !defaultTarget(target, branch)) {
    const candidates = refCandidates(target, branch);
    let listed: [RefObjects, RefObjects] | undefined;
    let oversized = false;
    if (
      candidates.length &&
      !/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/i.test(candidates[0]!)
    ) {
      try {
        listed = await Promise.all([
          listRefs("heads", candidates[0]!),
          listRefs("tags", candidates[0]!),
        ]);
      } catch (error) {
        if (
          !(error instanceof AcquisitionError) ||
          error.code !== "metadata_limit_exceeded"
        )
          throw error;
        oversized = true;
      }
    }
    if (listed) {
      const [heads, tags] = listed;
      const match = [...candidates]
        .reverse()
        .find((candidate) => heads.has(candidate) || tags.has(candidate));
      if (match !== undefined) {
        const head = heads.get(match);
        sha =
          !tags.has(match) && head?.type === "commit"
            ? shaOf(head)
            : await commitOf(match);
        if (sha) {
          ref = match;
          nested = [...heads.keys(), ...tags.keys()].some((name) =>
            name.startsWith(`${match}/`),
          );
        }
      }
    }
    if (!sha)
      for (const candidate of oversized
        ? [...candidates].reverse()
        : candidates) {
        sha = await commitOf(candidate);
        if (!sha) continue;
        ref = candidate;
        break;
      }
    if (!sha) throw new AcquisitionError("ref_unavailable");
  }
  sha ??= shaOf(await apiGet(fetcher, commitUrl(branch), token, signal));
  return {
    repositoryId: String(id),
    owner: canonicalOwner,
    name: canonicalName,
    defaultBranch: branch,
    visibility,
    sha,
    sizeKb:
      Number.isSafeInteger(size) && (size as number) >= 0
        ? (size as number)
        : null,
    ...(ref === undefined ? {} : { ref }),
    ...(nested === undefined ? {} : { nested }),
  };
}

function defaultTarget(target: RefTarget, branch: string): boolean {
  return (
    target.path === branch ||
    (!target.exact && target.path.startsWith(`${branch}/`))
  );
}

export function refCandidates(target: RefTarget, branch: string): string[] {
  if (defaultTarget(target, branch)) return [];
  if (target.exact) return target.path.length <= REF_LIMIT ? [target.path] : [];
  return refPrefixes(target.path)
    .filter((candidate) => candidate.length <= REF_LIMIT)
    .slice(0, REF_ATTEMPTS);
}

export async function openArchive(
  fetcher: Fetcher,
  resolution: Resolution,
  token: string | undefined,
  signal: AbortSignal,
): Promise<ReadableStream<Uint8Array>> {
  if (!/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(resolution.sha))
    throw new AcquisitionError("download_failed");
  const response = await fetcher(
    apiUrl(resolution.owner, resolution.name, `/tarball/${resolution.sha}`),
    {
      method: "GET",
      headers: headers(token),
      cache: "no-store",
      credentials: "omit",
      redirect: "follow",
      signal,
    },
  );
  if (!response.ok) {
    if (response.status === 404)
      throw new AcquisitionError("repository_unavailable");
    const failure = apiFailure(response);
    if (
      failure.code === "rate_limited" &&
      trustedOrigin(response, "https://codeload.github.com")
    )
      throw new AcquisitionError("archive_throttled", failure.retryAt);
    throw failure;
  }
  if (!trustedOrigin(response, "https://codeload.github.com")) {
    await response.body?.cancel().catch(() => undefined);
    throw new AcquisitionError("download_failed");
  }
  const length = Number(response.headers.get("content-length"));
  if (Number.isFinite(length) && length > ARCHIVE_LIMIT) {
    await response.body?.cancel().catch(() => undefined);
    throw new AcquisitionError("compressed_limit_exceeded");
  }
  if (!response.body) throw new AcquisitionError("download_failed");
  return response.body;
}

export async function downloadArchive(
  fetcher: Fetcher,
  resolution: Resolution,
  token: string | undefined,
  signal: AbortSignal,
): Promise<{ bytes: number; finalOrigin: "https://codeload.github.com" }> {
  const reader = (
    await openArchive(fetcher, resolution, token, signal)
  ).getReader();
  let bytes = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > ARCHIVE_LIMIT)
        throw new AcquisitionError("compressed_limit_exceeded");
    }
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    throw error;
  } finally {
    reader.releaseLock();
  }
  return { bytes, finalOrigin: "https://codeload.github.com" };
}

export function safeFailure(
  error: unknown,
  signal: AbortSignal,
): { code: AcquisitionErrorCode; retryAt?: number } {
  if (error instanceof AcquisitionError)
    return { code: error.code, retryAt: error.retryAt };
  if (signal.aborted)
    return {
      code:
        signal.reason === "deadline" ? "analysis_timeout" : "analysis_canceled",
    };
  return { code: "network_unavailable" };
}
