import { validRepository } from "../../extension/src/github/repository";
import { expect, test } from "bun:test";
import {
  AcquisitionError,
  ARCHIVE_LIMIT,
  downloadArchive,
  METADATA_LIMIT,
  refCandidates,
  resolveRepository,
  safeFailure,
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

test("resolves the longest branch or tag a page names, even when a tag shares a branch prefix", async () => {
  const branchSha = "b".repeat(40);
  const tagSha = "c".repeat(40);
  const tagObject = "d".repeat(40);
  const resolve = async (
    target: { path: string; exact: boolean },
    refs: {
      heads?: string[];
      tags?: string[];
      commits?: Record<string, number>;
      oversized?: boolean;
    } = {},
  ) => {
    const urls: string[] = [];
    const heads = refs.heads ?? [];
    const tags = refs.tags ?? [];
    const fetcher = (async (url: string) => {
      urls.push(url);
      if (urls.length === 1)
        return response(
          metadata(),
          "https://api.github.com/repos/owner/canonical",
        );
      const listing = /\/git\/matching-refs\/(heads|tags)\/(.+)$/.exec(url);
      if (listing) {
        if (refs.oversized)
          return response("[]", url, 200, {
            "content-length": String(METADATA_LIMIT + 1),
          });
        const kind = listing[1]!;
        const prefix = listing[2]!.split("/").map(decodeURIComponent).join("/");
        return response(
          JSON.stringify(
            (kind === "heads" ? heads : tags)
              .filter((name) => name.startsWith(prefix))
              .map((name) => ({
                ref: `refs/${kind}/${name}`,
                object:
                  kind === "heads"
                    ? {
                        sha: (name === "main" ? sha : branchSha).toUpperCase(),
                        type: "commit",
                      }
                    : { sha: tagObject, type: "tag" },
              })),
          ),
          url,
        );
      }
      const ref = decodeURIComponent(url.split("/commits/")[1] ?? "");
      if (ref === "main") return response(JSON.stringify({ sha }), url);
      if (tags.includes(ref))
        return response(JSON.stringify({ sha: tagSha }), url);
      if (heads.includes(ref))
        return response(JSON.stringify({ sha: branchSha }), url);
      const status = refs.commits?.[ref];
      return status === 200
        ? response(JSON.stringify({ sha: branchSha }), url)
        : response("{}", url, status ?? 422);
    }) as Fetcher;
    try {
      const result = await resolveRepository(
        fetcher,
        "owner",
        "repo",
        undefined,
        controller.signal,
        target,
      );
      return {
        urls: urls.slice(1),
        sha: result.sha,
        ref: result.ref,
        nested: result.nested,
      };
    } catch (error) {
      return { urls: urls.slice(1), code: (error as AcquisitionError).code };
    }
  };
  const repo = "https://api.github.com/repos/owner/canonical";
  const commits = `${repo}/commits/`;
  const listings = (prefix: string) => [
    `${repo}/git/matching-refs/heads/${prefix}`,
    `${repo}/git/matching-refs/tags/${prefix}`,
  ];
  expect(await resolve({ path: "main", exact: true })).toEqual({
    urls: [`${commits}main`],
    sha,
    ref: undefined,
    nested: undefined,
  });
  expect(
    await resolve(
      { path: "main/src/app.ts", exact: false },
      { heads: ["main"] },
    ),
  ).toEqual({
    urls: listings("main"),
    sha,
    ref: undefined,
    nested: false,
  });
  const defaultCollision = { heads: ["main"], tags: ["main/v2"] };
  for (const path of ["main/v2", "main/v2/src/app.ts"])
    expect(await resolve({ path, exact: false }, defaultCollision)).toEqual({
      urls: [...listings("main"), `${commits}main%2Fv2`],
      sha: tagSha,
      ref: "main/v2",
      nested: false,
    });
  expect(
    await resolve({ path: "main/src/app.ts", exact: false }, defaultCollision),
  ).toEqual({
    urls: listings("main"),
    sha,
    ref: undefined,
    nested: true,
  });
  expect(
    await resolve(
      { path: "ding-dong/src", exact: false },
      { heads: ["ding-dong"] },
    ),
  ).toEqual({
    urls: listings("ding-dong"),
    sha: branchSha,
    ref: "ding-dong",
    nested: false,
  });
  const collision = { heads: ["release/v2"], tags: ["release"] };
  for (const path of ["release/v2", "release/v2/src/index.ts"])
    expect(await resolve({ path, exact: false }, collision)).toEqual({
      urls: listings("release"),
      sha: branchSha,
      ref: "release/v2",
      nested: false,
    });
  expect(
    await resolve({ path: "release/src", exact: false }, collision),
  ).toEqual({
    urls: [...listings("release"), `${commits}release`],
    sha: tagSha,
    ref: "release",
    nested: true,
  });
  expect(
    await resolve(
      { path: "release/v2/src", exact: false },
      { ...collision, oversized: true },
    ),
  ).toEqual({
    urls: [
      ...listings("release"),
      `${commits}release%2Fv2%2Fsrc`,
      `${commits}release%2Fv2`,
    ],
    sha: branchSha,
    ref: "release/v2",
    nested: undefined,
  });
  expect(
    await resolve(
      { path: "1a2b3c4/src/app.ts", exact: false },
      { commits: { "1a2b3c4": 200 } },
    ),
  ).toEqual({
    urls: [...listings("1a2b3c4"), `${commits}1a2b3c4`],
    sha: branchSha,
    ref: "1a2b3c4",
    nested: undefined,
  });
  expect(
    await resolve({ path: "feature/x", exact: true }, { heads: ["feature/x"] }),
  ).toEqual({
    urls: listings("feature/x"),
    sha: branchSha,
    ref: "feature/x",
    nested: false,
  });
  const full = "f".repeat(40);
  expect(
    await resolve(
      { path: `${full}/src/app.ts`, exact: false },
      { commits: { [full]: 200 } },
    ),
  ).toEqual({
    urls: [`${commits}${full}`],
    sha: branchSha,
    ref: full,
    nested: undefined,
  });
  const missing = await resolve({ path: "a/b/c/d/e/f/g", exact: false });
  expect(missing.code).toBe("ref_unavailable");
  expect(missing.urls).toHaveLength(7);
  expect(
    (await resolve({ path: "gone", exact: true }, { commits: { gone: 404 } }))
      .code,
  ).toBe("ref_unavailable");
  expect(
    (
      await resolve(
        { path: "limited", exact: true },
        { commits: { limited: 403 } },
      )
    ).code,
  ).toBe("repository_forbidden");
  expect(refCandidates({ path: "x".repeat(256), exact: true }, "main")).toEqual(
    [],
  );
  expect((await resolve({ path: "x".repeat(256), exact: true })).code).toBe(
    "ref_unavailable",
  );
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

test("waits for the quota reset only when the core limit is used up", async () => {
  const reset = String(Math.floor(Date.now() / 1000) + 3600);
  const secondary = (async () =>
    response("", "https://api.github.com/repos/owner/repo", 429, {
      "x-ratelimit-remaining": "4963",
      "x-ratelimit-reset": reset,
    })) as Fetcher;
  const secondaryFailure = await resolveRepository(
    secondary,
    "owner",
    "repo",
    "test",
    controller.signal,
  ).catch((error: unknown) => error);
  expect(secondaryFailure).toMatchObject({ code: "rate_limited" });
  expect((secondaryFailure as AcquisitionError).retryAt).toBeUndefined();
  const before = Date.now();
  const retryAfter = (async () =>
    response("", "https://api.github.com/repos/owner/repo", 403, {
      "x-ratelimit-remaining": "4963",
      "x-ratelimit-reset": reset,
      "retry-after": "30",
    })) as Fetcher;
  const retryFailure = (await resolveRepository(
    retryAfter,
    "owner",
    "repo",
    "test",
    controller.signal,
  ).catch((error: unknown) => error)) as AcquisitionError;
  expect(retryFailure.code).toBe("rate_limited");
  expect(retryFailure.retryAt).toBeGreaterThanOrEqual(before + 30_000);
  expect(retryFailure.retryAt).toBeLessThan(before + 3_600_000);
});

test("reports a throttled archive separately from the API rate limit", async () => {
  const resolution = {
    repositoryId: "42",
    owner: "owner",
    name: "repo",
    defaultBranch: "main",
    visibility: "public" as const,
    sha,
    sizeKb: 1024,
  };
  const throttled = (async () =>
    response(
      "",
      "https://codeload.github.com/owner/repo/legacy.tar.gz/x",
      429,
    )) as Fetcher;
  const throttledFailure = (await downloadArchive(
    throttled,
    resolution,
    undefined,
    controller.signal,
  ).catch((error: unknown) => error)) as AcquisitionError;
  expect(throttledFailure.code).toBe("archive_throttled");
  expect(throttledFailure.retryAt).toBeUndefined();
  const before = Date.now();
  const delayed = (async () =>
    response(
      "",
      "https://codeload.github.com/owner/repo/legacy.tar.gz/x",
      429,
      {
        "retry-after": "20",
      },
    )) as Fetcher;
  const delayedFailure = (await downloadArchive(
    delayed,
    resolution,
    undefined,
    controller.signal,
  ).catch((error: unknown) => error)) as AcquisitionError;
  expect(delayedFailure.code).toBe("archive_throttled");
  expect(delayedFailure.retryAt).toBeGreaterThanOrEqual(before + 20_000);
  const api = (async () =>
    response(
      "",
      `https://api.github.com/repos/owner/repo/tarball/${sha}`,
      429,
      {
        "x-ratelimit-remaining": "10",
      },
    )) as Fetcher;
  expect(
    await downloadArchive(api, resolution, undefined, controller.signal).catch(
      (error: unknown) => error,
    ),
  ).toMatchObject({ code: "rate_limited" });
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
