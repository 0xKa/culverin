import { expect, test } from "bun:test";
import { createGitHubRuntime } from "../../extension/src/background/github";
import { createBackgroundResources } from "../../extension/src/background/resources";
import { createAuthService } from "../../extension/src/background/auth";
import { createPublicAnalysis } from "../../extension/src/background/analysis";
import { createSettingsHandler } from "../../extension/src/background/settings";
import { createSenderGates } from "../../extension/src/background/senders";
import { COUNT_TRIGGER_KEY } from "../../extension/src/counting/trigger";
import { DOWNLOAD_LIMIT_KEY } from "../../extension/src/counting/download-limit";
import { ArchiveError } from "../../extension/src/archive/tar";
import { aboutVisibility } from "../../extension/src/repository-page/visibility";
import {
  PAGE_COUNT_FORMAT_KEY,
  PAGE_SIZE_UNITS_KEY,
} from "../../extension/src/repository-page/numbers";
import type {
  PublicPayload,
  PublicRequest,
} from "../../extension/src/github/public-protocol";
import type { SettingsRequest } from "../../extension/src/protocol/settings";
import { event } from "./support/events";
import { result } from "./support/result";

function storage() {
  const values: Record<string, unknown> = {};
  return {
    values,
    get: async (key: string | string[] | null) =>
      key === null
        ? structuredClone(values)
        : Object.fromEntries(
            (Array.isArray(key) ? key : [key]).map((name) => [
              name,
              structuredClone(values[name]),
            ]),
          ),
    set: async (items: Record<string, unknown>) => {
      Object.assign(values, structuredClone(items));
    },
    remove: async (keys: string | string[]) => {
      for (const key of Array.isArray(keys) ? keys : [keys]) delete values[key];
    },
    getBytesInUse: async (key: string) =>
      new TextEncoder().encode(JSON.stringify({ [key]: values[key] })).length,
    setAccessLevel: async () => undefined,
  };
}
function fixture() {
  const local = storage();
  const session = storage();
  const sync = storage();
  const browser = {
    runtime: {
      id: "test",
      getURL: (path: string) => `chrome-extension://test/${path}`,
      onConnect: event<(port: chrome.runtime.Port) => void>(),
      getContexts: async () => [],
    },
    tabs: {
      onUpdated: event(),
      onRemoved: event(),
      sendMessage: async () => undefined,
    },
    storage: { local, session, sync },
  } as unknown as typeof chrome;
  const calls: string[] = [];
  const tokens: (string | undefined)[] = [];
  const limits: number[] = [];
  let failure: ((compressed: number) => unknown) | undefined;
  let visibility = "public";
  const branches: Record<string, string> = {
    main: "a".repeat(40),
    "ding-dong": "b".repeat(40),
    "feature/x": "c".repeat(40),
    "same-as-main": "a".repeat(40),
  };
  const tags: Record<string, string> = {};
  let rateLimitStatus = 200;
  const authorizations: (string | null)[] = [];
  const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push(url);
    if (url === "https://api.github.com/rate_limit") {
      const authorization = new Headers(init?.headers).get("authorization");
      authorizations.push(authorization);
      const limit = authorization ? 5000 : 60;
      const response = new Response(
        rateLimitStatus === 200
          ? JSON.stringify({
              resources: {
                core: { limit, remaining: limit - 7, reset: 1900000000 },
              },
            })
          : "{}",
        { status: rateLimitStatus },
      );
      Object.defineProperty(response, "url", { value: url });
      return response;
    }
    if (url === "https://api.github.com/user") {
      authorizations.push(new Headers(init?.headers).get("authorization"));
      const response = new Response(JSON.stringify({ login: "octo" }), {
        status: rateLimitStatus,
        headers: {
          "x-ratelimit-limit": "5000",
          "x-ratelimit-remaining": "4963",
          "x-ratelimit-reset": "1900000000",
          "x-ratelimit-resource": "core",
        },
      });
      Object.defineProperty(response, "url", { value: url });
      return response;
    }
    const listing = /\/git\/matching-refs\/(heads|tags)\/(.+)$/.exec(url);
    if (listing) {
      const kind = listing[1]!;
      const prefix = listing[2]!.split("/").map(decodeURIComponent).join("/");
      const response = new Response(
        JSON.stringify(
          Object.entries(kind === "heads" ? branches : tags)
            .filter(([name]) => name.startsWith(prefix))
            .map(([name, sha]) => ({
              ref: `refs/${kind}/${name}`,
              object: { sha, type: "commit" },
            })),
        ),
        { status: 200 },
      );
      Object.defineProperty(response, "url", { value: url });
      return response;
    }
    const ref = url.includes("/commits/")
      ? decodeURIComponent(url.split("/commits/")[1]!)
      : undefined;
    if (
      ref !== undefined &&
      ref !== "main" &&
      !(ref in branches) &&
      !(ref in tags)
    ) {
      const missing = new Response("{}", { status: 422 });
      Object.defineProperty(missing, "url", { value: url });
      return missing;
    }
    const response = new Response(
      JSON.stringify(
        ref !== undefined
          ? {
              sha:
                ref === "main" ? "a".repeat(40) : (tags[ref] ?? branches[ref]),
            }
          : {
              id: 42,
              owner: { login: "culverin" },
              name: "sample",
              default_branch: "main",
              private: visibility === "private",
              size: 1,
            },
      ),
      { status: 200 },
    );
    Object.defineProperty(response, "url", { value: url });
    return response;
  }) as typeof fetch;
  const resources = createBackgroundResources(browser, fetcher, async (job) => {
    tokens.push(job.token);
    limits.push(job.limits.compressed);
    if (failure) throw failure(job.limits.compressed);
    return {
      result: await result("42", job.resolution.sha),
      transport: { compressedBytes: 0, decompressedBytes: 0 },
      wasmLinearMemoryBytes: 0,
    };
  });
  const auth = createAuthService(resources);
  const analysis = createPublicAnalysis(resources, auth);
  function run(
    type: PublicRequest["type"],
    page: boolean,
    force = false,
    target?: { path: string; exact: boolean },
    navigationId: string = crypto.randomUUID(),
  ): Promise<PublicPayload> {
    const request: PublicRequest = {
      protocolVersion: 1,
      requestId: crypto.randomUUID(),
      navigationId,
      type,
      repository: { owner: "culverin", name: "sample" },
    };
    return new Promise((resolve) =>
      analysis.run(request, {
        repository: request.repository!,
        ...(target ? { target } : {}),
        owner: `p:1:document:${request.navigationId}`,
        prefix: "p:1:document:",
        page,
        force,
        isAlive: () => true,
        reply: (_request, payload) => resolve(payload),
        progress: () => undefined,
      }),
    );
  }
  return {
    browser,
    fetcher,
    resources,
    auth,
    run,
    calls,
    tokens,
    limits,
    fail: (next: (compressed: number) => unknown) => {
      failure = next;
    },
    local,
    session,
    sync,
    authorizations,
    private: () => {
      visibility = "private";
    },
    branches,
    tags,
    rateLimitStatus: (status: number) => {
      rateLimitStatus = status;
    },
  };
}

test("page display replies expose only the independent formatting choices and About items without acquisition", async () => {
  const api = fixture();
  api.sync.values[PAGE_COUNT_FORMAT_KEY] = "full";
  api.sync.values[PAGE_SIZE_UNITS_KEY] = "decimal";
  api.sync.values[aboutVisibility.key] = "none";
  api.sync.values["culverin.countFormat"] = "abbreviated";
  api.sync.values["culverin.sizeUnits"] = "binary";
  api.local.values["github.connection"] = { token: "fixture-token" };
  const runtime = createGitHubRuntime(api.browser, api.fetcher);
  const request = {
    protocolVersion: 1,
    requestId: crypto.randomUUID(),
    navigationId: crypto.randomUUID(),
    type: "display.get",
  };
  const sender = {
    id: "test",
    frameId: 0,
    documentId: "fixture-document",
    url: "https://github.com/culverin/sample",
    tab: { id: 1, url: "https://github.com/culverin/sample" },
  } as chrome.runtime.MessageSender;
  const reply = await new Promise((resolve) =>
    expect(runtime.handleGithub(request, sender, resolve)).toBe(true),
  );
  expect(reply).toEqual({
    ...request,
    type: "display",
    items: ["lines", "files", "size"],
    formats: { counts: "full", sizes: "decimal" },
    visibility: "none",
  });
  expect(api.calls).toEqual([]);
  expect(api.tokens).toEqual([]);
});

test("surface policies avoid requests on open and only opt-in page lookups claim automatic counting", async () => {
  const api = fixture();
  expect(await api.run("repository.lookup", false)).toEqual({
    type: "repository.not_cached",
  });
  expect(await api.run("repository.lookup", true)).toEqual({
    type: "repository.not_cached",
  });
  expect(api.calls).toHaveLength(0);
  api.sync.values[COUNT_TRIGGER_KEY] = "open";
  expect(await api.run("repository.lookup", true)).toMatchObject({
    type: "repository.cache_miss",
    autoCount: true,
  });
  expect(api.calls).toHaveLength(2);
  expect(await api.run("repository.lookup", true)).not.toHaveProperty(
    "autoCount",
  );
  expect(api.tokens).toEqual([]);
});

test("only the request that follows an automatic-count lookup is limited to 256 MiB", async () => {
  const mib = 1024 * 1024;
  const automatic = fixture();
  automatic.sync.values[COUNT_TRIGGER_KEY] = "open";
  automatic.sync.values[DOWNLOAD_LIMIT_KEY] = 2048;
  const navigation = crypto.randomUUID();
  expect(
    await automatic.run(
      "repository.lookup",
      true,
      false,
      undefined,
      navigation,
    ),
  ).toMatchObject({ autoCount: true });
  expect(
    await automatic.run("analysis.request", true, false, undefined, navigation),
  ).toMatchObject({ type: "analysis.completed" });
  expect(automatic.limits).toEqual([256 * mib]);

  const clicked = fixture();
  clicked.sync.values[COUNT_TRIGGER_KEY] = "open";
  clicked.sync.values[DOWNLOAD_LIMIT_KEY] = 2048;
  const other = crypto.randomUUID();
  expect(
    await clicked.run("repository.lookup", true, false, undefined, other),
  ).toMatchObject({ autoCount: true });
  await clicked.run("analysis.status", true, false, undefined, other);
  await clicked.run("analysis.request", true, false, undefined, other);
  expect(clicked.limits).toEqual([2048 * mib]);

  const unset = fixture();
  await unset.run("analysis.request", true);
  expect(unset.limits).toEqual([512 * mib]);
});

test("an automatic count that reaches its fixed limit offers a count with the user's limit", async () => {
  const mib = 1024 * 1024;
  const automaticFailure = async (
    setting: number | undefined,
    error: (compressed: number) => unknown,
  ) => {
    const api = fixture();
    api.sync.values[COUNT_TRIGGER_KEY] = "open";
    if (setting) api.sync.values[DOWNLOAD_LIMIT_KEY] = setting;
    api.fail(error);
    const navigation = crypto.randomUUID();
    await api.run("repository.lookup", true, false, undefined, navigation);
    return api.run("analysis.request", true, false, undefined, navigation);
  };
  const download = (compressed: number) =>
    new ArchiveError("compressed_limit_exceeded", "compressed", compressed);
  const unpacked = (compressed: number) =>
    new ArchiveError(
      "decompressed_limit_exceeded",
      "decompressed",
      compressed * 8,
    );
  expect(await automaticFailure(undefined, download)).toEqual({
    type: "analysis.failed",
    code: "auto_download_limit",
    limitBytes: 512 * mib,
  });
  expect(await automaticFailure(2048, unpacked)).toEqual({
    type: "analysis.failed",
    code: "auto_download_limit",
    limitBytes: 2048 * mib,
  });
  expect(await automaticFailure(256, download)).toEqual({
    type: "analysis.failed",
    code: "compressed_limit_exceeded",
    limit: "compressed",
    limitBytes: 256 * mib,
  });
  const clicked = fixture();
  clicked.fail(download);
  expect(await clicked.run("analysis.request", true)).toEqual({
    type: "analysis.failed",
    code: "compressed_limit_exceeded",
    limit: "compressed",
    limitBytes: 512 * mib,
  });
});

test("same-commit forced analysis refreshes metadata and reuses results; private visibility purges public results", async () => {
  const api = fixture();
  expect(await api.run("analysis.request", false)).toMatchObject({
    type: "analysis.completed",
    fromCache: false,
  });
  expect(await api.run("analysis.request", false, true)).toMatchObject({
    type: "analysis.completed",
    fromCache: true,
  });
  expect(api.calls).toHaveLength(4);
  expect(api.tokens).toEqual([undefined]);
  const generation = await api.resources.connection.generation();
  await api.resources.connection.connect(
    { method: "token", login: "octo", token: "fixture-token" },
    generation,
  );
  api.private();
  expect(await api.run("analysis.request", false)).toMatchObject({
    type: "analysis.completed",
    resolution: { visibility: "private" },
  });
  expect(api.tokens).toEqual([undefined, "fixture-token"]);
  expect(
    await api.resources.cache.hasRepository(
      { owner: "culverin", name: "sample" },
      (await api.resources.currentRules()).hash,
    ),
  ).toBe(false);
});

test("branch pages resolve their own commit, share results by commit, and keep the most recent label", async () => {
  const api = fixture();
  const page = (path: string) => ({ path, exact: true });
  const browse = (path: string) => ({ path, exact: false });
  expect(
    await api.run("repository.lookup", true, false, page("ding-dong")),
  ).toEqual({ type: "repository.not_cached" });
  expect(api.calls).toHaveLength(0);
  expect(await api.run("analysis.request", false)).toMatchObject({
    type: "analysis.completed",
    resolution: { defaultBranch: "main", sha: "a".repeat(40) },
  });
  expect(api.calls).toHaveLength(2);
  expect(
    await api.run("repository.lookup", true, false, page("ding-dong")),
  ).toEqual({ type: "repository.not_cached" });
  expect(
    await api.run("repository.lookup", true, false, page("main")),
  ).toMatchObject({
    type: "repository.cache_hit",
    resolution: { sha: "a".repeat(40) },
  });
  expect(
    await api.run("repository.lookup", false, false, browse("main/src/app.ts")),
  ).toEqual({ type: "repository.not_cached" });
  expect(api.calls).toHaveLength(2);
  const branch = await api.run(
    "analysis.request",
    false,
    false,
    browse("ding-dong/src"),
  );
  expect(branch).toMatchObject({
    type: "analysis.completed",
    fromCache: false,
    resolution: { ref: "ding-dong", sha: "b".repeat(40) },
  });
  expect(api.calls.slice(2)).toEqual([
    "https://api.github.com/repos/culverin/sample",
    "https://api.github.com/repos/culverin/sample/git/matching-refs/heads/ding-dong",
    "https://api.github.com/repos/culverin/sample/git/matching-refs/tags/ding-dong",
  ]);
  expect(
    await api.run("repository.lookup", true, false, page("ding-dong")),
  ).toMatchObject({
    type: "repository.cache_hit",
    resolution: { ref: "ding-dong" },
    result: { revision: { commitSha: "b".repeat(40) } },
  });
  expect(
    await api.run("repository.lookup", false, false, browse("ding-dong/docs")),
  ).toMatchObject({ type: "repository.cache_hit" });
  expect(await api.run("repository.lookup", false)).toMatchObject({
    type: "repository.cache_hit",
    result: { revision: { commitSha: "a".repeat(40) } },
  });
  expect(api.calls).toHaveLength(5);
  expect(
    await api.run(
      "analysis.request",
      false,
      false,
      browse("feature/x/README.md"),
    ),
  ).toMatchObject({ resolution: { ref: "feature/x" } });
  expect(api.calls.slice(5)).toEqual([
    "https://api.github.com/repos/culverin/sample",
    "https://api.github.com/repos/culverin/sample/git/matching-refs/heads/feature",
    "https://api.github.com/repos/culverin/sample/git/matching-refs/tags/feature",
  ]);
  expect(
    await api.run("analysis.request", false, false, page("same-as-main")),
  ).toMatchObject({
    type: "analysis.completed",
    fromCache: true,
    resolution: { ref: "same-as-main" },
  });
  const hash = (await api.resources.currentRules()).hash;
  const labels = async () =>
    Object.fromEntries(
      (
        api.local.values["culverin.public-results.v1"] as {
          entries: { resolution: { ref?: string; sha: string } }[];
        }
      ).entries.map((entry) => [entry.resolution.sha[0], entry.resolution.ref]),
    );
  expect(await labels()).toEqual({
    a: "same-as-main",
    b: "ding-dong",
    c: "feature/x",
  });
  expect(
    await api.resources.cache.hasRef(
      { owner: "culverin", name: "sample" },
      "main",
      hash,
    ),
  ).toBe(true);
  expect(await api.run("repository.lookup", true)).toMatchObject({
    type: "repository.cache_hit",
  });
  expect((await labels()).a).toBeUndefined();
  expect(
    await api.run("analysis.request", false, false, page("deleted")),
  ).toEqual({ type: "analysis.failed", code: "ref_unavailable" });
  expect(api.tokens).toHaveLength(3);
});

test("a tag under the default branch resolves correctly with a cold or cached default branch", async () => {
  for (const cachedDefault of [false, true]) {
    const api = fixture();
    api.tags["main/v2"] = "d".repeat(40);
    const browse = (path: string) => ({ path, exact: false });
    if (cachedDefault) await api.run("analysis.request", false);
    const calls = api.calls.length;
    for (const path of ["main/v2", "main/v2/src/app.ts"])
      expect(
        await api.run("repository.lookup", false, false, browse(path)),
      ).toEqual({ type: "repository.not_cached" });
    expect(api.calls).toHaveLength(calls);
    expect(
      await api.run(
        "analysis.request",
        false,
        false,
        browse("main/v2/src/app.ts"),
      ),
    ).toMatchObject({
      type: "analysis.completed",
      fromCache: false,
      resolution: { ref: "main/v2", sha: "d".repeat(40) },
    });
    const resolvedCalls = api.calls.length;
    for (const path of ["main/v2", "main/v2/docs"])
      expect(
        await api.run("repository.lookup", false, false, browse(path)),
      ).toMatchObject({
        type: "repository.cache_hit",
        resolution: { ref: "main/v2", sha: "d".repeat(40) },
      });
    expect(api.calls).toHaveLength(resolvedCalls);
    expect(api.tokens).toHaveLength(cachedDefault ? 2 : 1);
  }
});

test("default branch folder reuse requires ruling out nested refs and keeps the default label", async () => {
  for (const nested of [false, true]) {
    const api = fixture();
    if (nested) api.tags["main/v2"] = "d".repeat(40);
    const browse = (path: string) => ({ path, exact: false });
    await api.run("analysis.request", false);
    expect(
      await api.run("repository.lookup", false, false, browse("main/docs")),
    ).toEqual({ type: "repository.not_cached" });
    expect(api.calls).toHaveLength(2);
    const resolved = await api.run(
      "analysis.request",
      false,
      false,
      browse("main/src/app.ts"),
    );
    expect(resolved).toMatchObject({
      type: "analysis.completed",
      fromCache: true,
      resolution: { defaultBranch: "main", sha: "a".repeat(40) },
    });
    expect(resolved).not.toHaveProperty("resolution.ref");
    expect(api.tokens).toHaveLength(1);
    expect(api.calls).toHaveLength(5);
    const folder = await api.run(
      "repository.lookup",
      false,
      false,
      browse("main/v2/docs"),
    );
    expect(folder).toMatchObject({
      type: nested ? "repository.not_cached" : "repository.cache_hit",
    });
    expect(api.calls).toHaveLength(5);
    expect(
      await api.run("repository.lookup", false, false, {
        path: "main",
        exact: true,
      }),
    ).toMatchObject({
      type: "repository.cache_hit",
      resolution: { sha: "a".repeat(40) },
    });
  }
});

test("a tag sharing a branch prefix never stands in for the branch", async () => {
  const api = fixture();
  api.tags.release = "d".repeat(40);
  api.branches["release/v2"] = "e".repeat(40);
  const browse = (path: string) => ({ path, exact: false });
  expect(
    await api.run("analysis.request", false, false, browse("release/src")),
  ).toMatchObject({
    type: "analysis.completed",
    resolution: { ref: "release", sha: "d".repeat(40) },
  });
  const calls = api.calls.length;
  for (const path of ["release/v2/src/index.ts", "release/docs"])
    expect(
      await api.run("repository.lookup", false, false, browse(path)),
    ).toEqual({ type: "repository.not_cached" });
  expect(api.calls).toHaveLength(calls);
  for (const path of ["release/v2", "release/v2/src/index.ts"])
    expect(
      await api.run("analysis.request", false, false, browse(path)),
    ).toMatchObject({
      type: "analysis.completed",
      resolution: { ref: "release/v2", sha: "e".repeat(40) },
    });
  expect(
    await api.run("repository.lookup", false, false, browse("release/v2/docs")),
  ).toMatchObject({
    type: "repository.cache_hit",
    resolution: { ref: "release/v2", sha: "e".repeat(40) },
  });
});

test("trusted analysis keeps its authorized public archive policy and strict sender gate", async () => {
  const api = fixture();
  await api.resources.connection.connect(
    { method: "token", login: "octo", token: "fixture-token" },
    await api.resources.connection.generation(),
  );
  const gates = createSenderGates({
    id: "test",
    settingsUrl: "chrome-extension://test/settings.html",
    popupUrl: "chrome-extension://test/popup.html",
  });
  const settings = createSettingsHandler(api.resources, api.auth, gates);
  const request: SettingsRequest = {
    protocolVersion: 1,
    requestId: crypto.randomUUID(),
    navigationId: crypto.randomUUID(),
    type: "analysis.request",
    owner: "culverin",
    name: "sample",
  };
  const sender = {
    id: "test",
    url: "chrome-extension://test/settings.html#github",
    frameId: 0,
    documentId: "document",
  };
  expect(
    settings.handle(request, { ...sender, frameId: 1 }, () => undefined),
  ).toBe(false);
  expect(
    settings.handle(
      request,
      { ...sender, url: "https://github.com/culverin/sample" },
      () => undefined,
    ),
  ).toBe(false);
  const outcome = await new Promise<unknown>((resolve) =>
    expect(settings.handle(request, sender, resolve)).toBe(true),
  );
  expect(outcome).toMatchObject({
    state: "analyzed",
    resolution: { visibility: "public" },
  });
  expect(api.tokens).toEqual(["fixture-token"]);
});

test("signing in keeps the rate limit GitHub reported for the new account", async () => {
  const api = fixture();
  const submissionId = crypto.randomUUID();
  await api.session.set({
    "github.rateLimit": { limit: 60, remaining: 1, reset: 1_950_000_000_000 },
    "github.pending": {
      token: "fixture-token",
      submissionId,
      createdAt: Date.now(),
    },
  });
  const outcome = await new Promise<unknown>(
    (resolve) =>
      void api.auth.handle(
        {
          protocolVersion: 1,
          requestId: crypto.randomUUID(),
          navigationId: crypto.randomUUID(),
          type: "auth.submit",
          submissionId,
        },
        resolve,
      ),
  );
  expect(outcome).toMatchObject({ state: "connected" });
  expect(api.calls).toEqual(["https://api.github.com/user"]);
  expect(api.session.values["github.rateLimit"]).toEqual({
    limit: 5000,
    remaining: 4963,
    reset: 1_900_000_000_000,
    authenticated: true,
  });
});

test("settings checks the rate limit for free without a connection and with one request when connected", async () => {
  const api = fixture();
  const gates = createSenderGates({
    id: "test",
    settingsUrl: "chrome-extension://test/settings.html",
    popupUrl: "chrome-extension://test/popup.html",
  });
  const settings = createSettingsHandler(api.resources, api.auth, gates);
  const sender = {
    id: "test",
    url: "chrome-extension://test/settings.html#counting",
    frameId: 0,
    documentId: "document",
  };
  const check = () =>
    new Promise<unknown>((resolve) =>
      expect(
        settings.handle(
          {
            protocolVersion: 1,
            requestId: crypto.randomUUID(),
            navigationId: crypto.randomUUID(),
            type: "rate-limit.check",
          },
          sender,
          resolve,
        ),
      ).toBe(true),
    );

  expect(await check()).toMatchObject({ state: "checked" });
  expect(api.calls).toEqual(["https://api.github.com/rate_limit"]);
  expect(api.authorizations).toEqual([null]);
  expect(api.session.values["github.rateLimit"]).toEqual({
    limit: 60,
    remaining: 53,
    reset: 1_900_000_000_000,
  });

  await api.resources.connection.connect(
    { method: "token", login: "octo", token: "fixture-token" },
    await api.resources.connection.generation(),
  );
  expect(await check()).toMatchObject({ state: "checked" });
  expect(api.calls.at(-1)).toBe("https://api.github.com/user");
  expect(api.authorizations.at(-1)).toBe("Bearer fixture-token");
  expect(api.session.values["github.rateLimit"]).toEqual({
    limit: 5000,
    remaining: 4963,
    reset: 1_900_000_000_000,
    authenticated: true,
  });

  api.rateLimitStatus(401);
  expect(await check()).toMatchObject({
    state: "failed",
    code: "authentication_invalid",
  });
  expect(await api.resources.connection.status()).toMatchObject({
    expired: true,
  });
});

test("runtime listener registration is explicit and idempotent", () => {
  const api = fixture();
  const runtime = createGitHubRuntime(api.browser, api.fetcher);
  expect(api.browser.runtime.onConnect.hasListener).toBeUndefined();
  const connect = api.browser.runtime.onConnect as unknown as ReturnType<
    typeof event<(port: chrome.runtime.Port) => void>
  >;
  expect(connect.listeners.size).toBe(0);
  runtime.initialize();
  runtime.initialize();
  expect(connect.listeners.size).toBe(1);
});

async function connectPrivate(api: ReturnType<typeof fixture>) {
  await api.resources.connection.connect(
    { method: "token", login: "octo", token: "fixture-token" },
    await api.resources.connection.generation(),
  );
  api.private();
}
function disconnect(api: ReturnType<typeof fixture>) {
  return new Promise(
    (resolve) =>
      void api.auth.handle(
        {
          protocolVersion: 1,
          requestId: crypto.randomUUID(),
          navigationId: crypto.randomUUID(),
          type: "auth.disconnect",
        },
        resolve,
      ),
  );
}
function disconnectDuring(
  api: ReturnType<typeof fixture>,
  method: "getWithDuration" | "put",
  order: "before" | "after",
) {
  const results = api.resources.privateResults;
  const original = results[method].bind(results) as (
    ...args: unknown[]
  ) => Promise<unknown>;
  Object.assign(results, {
    [method]: async (...args: unknown[]) => {
      Reflect.deleteProperty(results, method);
      if (order === "before") await disconnect(api);
      const value = await original(...args);
      if (order === "after") await disconnect(api);
      return value;
    },
  });
}
async function hasPrivateResult(api: ReturnType<typeof fixture>) {
  return api.resources.privateResults.hasRepository(
    { owner: "culverin", name: "sample" },
    (await api.resources.currentRules()).hash,
  );
}

test("a private result read before Disconnect is not delivered after it", async () => {
  const api = fixture();
  await connectPrivate(api);
  expect(await api.run("analysis.request", false)).toMatchObject({
    type: "analysis.completed",
    fromCache: false,
  });
  disconnectDuring(api, "getWithDuration", "after");
  expect(await api.run("analysis.request", false)).toEqual({
    type: "analysis.failed",
    code: "analysis_interrupted",
  });
  expect(await api.resources.connection.status()).toMatchObject({
    connected: false,
  });
});

test("a private analysis pending during Disconnect does not start with the old credential", async () => {
  const api = fixture();
  await connectPrivate(api);
  disconnectDuring(api, "getWithDuration", "after");
  expect(await api.run("analysis.request", false)).toEqual({
    type: "analysis.failed",
    code: "analysis_interrupted",
  });
  expect(api.tokens).toEqual([]);
});

test("a private result finishing during Disconnect is not kept", async () => {
  const api = fixture();
  await connectPrivate(api);
  disconnectDuring(api, "put", "before");
  expect(await api.run("analysis.request", false)).toEqual({
    type: "analysis.failed",
    code: "analysis_interrupted",
  });
  expect(api.tokens).toEqual(["fixture-token"]);
  expect(await hasPrivateResult(api)).toBe(false);
});
