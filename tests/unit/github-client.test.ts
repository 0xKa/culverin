import { expect, test } from "bun:test";
import {
  AcquisitionError,
  ARCHIVE_LIMIT,
  downloadArchive,
  resolveRepository,
  safeFailure,
  validRepository,
  type Fetcher,
} from "../../extension/src/github/client";

const sha = "a".repeat(40);
const controller = new AbortController();

function response(
  body: string | Uint8Array,
  url: string,
  status = 200,
  headers?: HeadersInit,
): Response {
  const value = new Response(
    typeof body === "string" ? body : String.fromCharCode(...body),
    { status, headers },
  );
  Object.defineProperty(value, "url", { value: url });
  return value;
}

function metadata(branch: string | null = "main"): string {
  return JSON.stringify({
    id: 42,
    name: "canonical",
    owner: { login: "owner" },
    private: false,
    default_branch: branch,
    size: 1024,
  });
}

test("resolves canonical identity and SHA with bounded no-store requests", async () => {
  const requests: { url: string; init: RequestInit }[] = [];
  const fetcher = (async (url: string, init: RequestInit) => {
    requests.push({ url, init });
    return requests.length === 1
      ? response(metadata(), "https://api.github.com/repos/owner/canonical")
      : response(
          JSON.stringify({ sha }),
          "https://api.github.com/repos/owner/canonical/commits/main",
        );
  }) as Fetcher;
  const result = await resolveRepository(
    fetcher,
    "Owner",
    "old-name",
    undefined,
    controller.signal,
  );
  expect(result).toEqual({
    repositoryId: "42",
    owner: "owner",
    name: "canonical",
    visibility: "public",
    defaultBranch: "main",
    sha,
    sizeKb: 1024,
  });
  expect(requests.map((r) => r.url)).toEqual([
    "https://api.github.com/repos/Owner/old-name",
    "https://api.github.com/repos/owner/canonical/commits/main",
  ]);
  expect(
    requests.every(
      (r) => r.init.cache === "no-store" && r.init.credentials === "omit",
    ),
  ).toBe(true);
  expect(
    requests.every((r) => !(r.init.headers as Headers).has("Authorization")),
  ).toBe(true);
  expect(requests.some((r) => r.url.includes("tarball"))).toBe(false);
});

test("keeps resolving when GitHub omits or malforms the repository size", async () => {
  for (const size of [undefined, null, -1, 1.5, "1024", 2 ** 53]) {
    let calls = 0;
    const fetcher = (async () =>
      ++calls === 1
        ? response(
            JSON.stringify({ ...JSON.parse(metadata()), size }),
            "https://api.github.com/repos/owner/canonical",
          )
        : response(
            JSON.stringify({ sha }),
            "https://api.github.com/repos/owner/canonical/commits/main",
          )) as Fetcher;
    const result = await resolveRepository(
      fetcher,
      "owner",
      "canonical",
      undefined,
      controller.signal,
    );
    expect(result.sizeKb).toBeNull();
  }
});

test("rejects invalid repository components and oversized metadata", async () => {
  expect(validRepository("../owner", "repo")).toBe(false);
  expect(validRepository("owner", ".github")).toBe(true);
  expect(validRepository("owner", "repo.git")).toBe(true);
  expect(validRepository("owner", "..")).toBe(false);
  const fetcher = (async () =>
    response(metadata(), "https://api.github.com/repos/owner/canonical", 200, {
      "content-length": "1048577",
    })) as Fetcher;
  expect(
    resolveRepository(fetcher, "owner", "repo", undefined, controller.signal),
  ).rejects.toMatchObject({ code: "metadata_limit_exceeded" });
});

test("keeps inaccessible private repository ambiguous and handles rate limits", async () => {
  const unavailable = (async () =>
    response("", "https://api.github.com/repos/owner/repo", 404)) as Fetcher;
  expect(
    resolveRepository(unavailable, "owner", "repo", "test", controller.signal),
  ).rejects.toMatchObject({ code: "repository_unavailable" });
  const limited = (async () =>
    response("", "https://api.github.com/repos/owner/repo", 403, {
      "x-ratelimit-remaining": "0",
      "x-ratelimit-reset": "2000000000",
    })) as Fetcher;
  expect(
    resolveRepository(limited, "owner", "repo", undefined, controller.signal),
  ).rejects.toMatchObject({ code: "rate_limited", retryAt: 2000000000000 });
});

test("classifies empty repository and rejects malformed commit", async () => {
  const empty = (async () =>
    response(
      metadata(null),
      "https://api.github.com/repos/owner/canonical",
    )) as Fetcher;
  expect(
    resolveRepository(empty, "owner", "repo", undefined, controller.signal),
  ).rejects.toMatchObject({ code: "repository_empty" });
  let calls = 0;
  const malformed = (async () => {
    calls++;
    return calls === 1
      ? response(metadata(), "https://api.github.com/repos/owner/canonical")
      : response(
          JSON.stringify({ sha: "branch" }),
          "https://api.github.com/repos/owner/canonical/commits/main",
        );
  }) as Fetcher;
  expect(
    resolveRepository(malformed, "owner", "repo", undefined, controller.signal),
  ).rejects.toMatchObject({ code: "network_unavailable" });
});

test("rejects wrong archive origin before reading and checks content length", async () => {
  const resolution = {
    repositoryId: "42",
    owner: "owner",
    name: "repo",
    defaultBranch: "main",
    visibility: "public" as const,
    sha,
    sizeKb: 1024,
  };
  const wrong = (async () =>
    response("body", "https://evil.example/archive")) as Fetcher;
  expect(
    downloadArchive(wrong, resolution, undefined, controller.signal),
  ).rejects.toMatchObject({ code: "download_failed" });
  const huge = (async () =>
    response("", "https://codeload.github.com/archive", 200, {
      "content-length": String(ARCHIVE_LIMIT + 1),
    })) as Fetcher;
  expect(
    downloadArchive(huge, resolution, undefined, controller.signal),
  ).rejects.toMatchObject({ code: "compressed_limit_exceeded" });
});

test("streams and discards archive bytes with a hard count", async () => {
  const resolution = {
    repositoryId: "42",
    owner: "owner",
    name: "repo",
    defaultBranch: "main",
    visibility: "public" as const,
    sha,
    sizeKb: 1024,
  };
  let request: RequestInit | undefined;
  const fetcher = (async (_url: string, init: RequestInit) => {
    request = init;
    return response(
      new Uint8Array([1, 2, 3]),
      "https://codeload.github.com/archive",
    );
  }) as Fetcher;
  expect(
    await downloadArchive(fetcher, resolution, "secret", controller.signal),
  ).toEqual({ bytes: 3, finalOrigin: "https://codeload.github.com" });
  expect(request?.cache).toBe("no-store");
  expect(request?.credentials).toBe("omit");
  expect((request?.headers as Headers).get("Authorization")).toBe(
    "Bearer secret",
  );
});

test("accepts archive response lengths above the former 50 MiB limit", async () => {
  const fetcher: Fetcher = async () =>
    response("body", "https://codeload.github.com/archive", 200, {
      "content-length": String(50 * 1024 * 1024 + 1),
    });
  await expect(
    downloadArchive(
      fetcher,
      {
        repositoryId: "42",
        owner: "owner",
        name: "repo",
        defaultBranch: "main",
        visibility: "public",
        sha,
        sizeKb: null,
      },
      undefined,
      controller.signal,
    ),
  ).resolves.toEqual({ bytes: 4, finalOrigin: "https://codeload.github.com" });
});

test("rejects a streaming archive overrun and cancels the reader", async () => {
  const resolution = {
    repositoryId: "42",
    owner: "owner",
    name: "repo",
    defaultBranch: "main",
    visibility: "public" as const,
    sha,
    sizeKb: 1024,
  };
  let canceled = false;
  const fetcher: Fetcher = async () =>
    ({
      url: "https://codeload.github.com/archive",
      ok: true,
      headers: new Headers(),
      body: {
        getReader: () => ({
          read: async () => ({
            done: false,
            value: { byteLength: ARCHIVE_LIMIT + 1 },
          }),
          cancel: async () => {
            canceled = true;
          },
          releaseLock: () => undefined,
        }),
      },
    }) as Response;
  await expect(
    downloadArchive(fetcher, resolution, undefined, controller.signal),
  ).rejects.toMatchObject({
    code: "compressed_limit_exceeded",
  });
  expect(canceled).toBe(true);
});

test("maps deadline aborts without exposing error details", () => {
  const expired = new AbortController();
  expired.abort("deadline");
  expect(safeFailure(new Error("secret url"), expired.signal)).toEqual({
    code: "analysis_timeout",
  });
});

test("does not expose arbitrary errors", () => {
  const error = new AcquisitionError("network_unavailable");
  expect(error.message).toBe("network_unavailable");
});
