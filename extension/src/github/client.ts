export const API_VERSION = "2026-03-10";
export const METADATA_LIMIT = 1024 * 1024;
export const ARCHIVE_LIMIT = 50 * 1024 * 1024;
export type Fetcher = (input: string, init: RequestInit) => Promise<Response>;

export type Resolution = {
  repositoryId: string;
  owner: string;
  name: string;
  defaultBranch: string;
  visibility: "public" | "private";
  sha: string;
  sizeKb: number | null;
};

export type AcquisitionErrorCode =
  | "invalid_repository"
  | "metadata_limit_exceeded"
  | "repository_unavailable"
  | "repository_empty"
  | "authentication_invalid"
  | "repository_forbidden"
  | "rate_limited"
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

const ownerPattern = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/;
const repositoryPattern = /^[A-Za-z0-9._-]{1,100}$/;

export function validLogin(login: string): boolean {
  return ownerPattern.test(login);
}

export function validRepository(owner: string, name: string): boolean {
  return (
    ownerPattern.test(owner) &&
    repositoryPattern.test(name) &&
    name !== "." &&
    name !== ".."
  );
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
        : Number.isFinite(reset) && reset > 0
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

async function apiGet(
  fetcher: Fetcher,
  url: string,
  token: string | undefined,
  signal: AbortSignal,
): Promise<unknown> {
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
  if (!response.ok) throw apiFailure(response);
  return boundedJson(response);
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

export async function resolveRepository(
  fetcher: Fetcher,
  owner: string,
  name: string,
  token: string | undefined,
  signal: AbortSignal,
): Promise<Resolution> {
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
  const commit = record(
    await apiGet(
      fetcher,
      apiUrl(
        canonicalOwner,
        canonicalName,
        `/commits/${encodeURIComponent(branch)}`,
      ),
      token,
      signal,
    ),
  );
  const sha = commit?.sha;
  if (typeof sha !== "string" || !/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/i.test(sha))
    throw new AcquisitionError("network_unavailable");
  return {
    repositoryId: String(id),
    owner: canonicalOwner,
    name: canonicalName,
    defaultBranch: branch,
    visibility,
    sha: sha.toLowerCase(),
    sizeKb:
      Number.isSafeInteger(size) && (size as number) >= 0
        ? (size as number)
        : null,
  };
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
    throw apiFailure(response);
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
