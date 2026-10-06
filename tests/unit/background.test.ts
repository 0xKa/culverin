import { expect, test } from "bun:test";
import { createGitHubRuntime } from "../../extension/src/background/github";
import { createBackgroundResources } from "../../extension/src/background/resources";
import { createAuthService } from "../../extension/src/background/auth";
import { createPublicAnalysis } from "../../extension/src/background/analysis";
import { createSettingsHandler } from "../../extension/src/background/settings";
import { createSenderGates } from "../../extension/src/background/senders";
import { COUNT_TRIGGER_KEY } from "../../extension/src/counting/trigger";
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
  let visibility = "public";
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
    const response = new Response(
      JSON.stringify(
        url.includes("/commits/")
          ? { sha: "a".repeat(40) }
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
    return {
      result: await result("42"),
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
  ): Promise<PublicPayload> {
    const request: PublicRequest = {
      protocolVersion: 1,
      requestId: crypto.randomUUID(),
      navigationId: crypto.randomUUID(),
      type,
      repository: { owner: "culverin", name: "sample" },
    };
    return new Promise((resolve) =>
      analysis.run(request, {
        repository: request.repository!,
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
    local,
    session,
    sync,
    authorizations,
    private: () => {
      visibility = "private";
    },
    rateLimitStatus: (status: number) => {
      rateLimitStatus = status;
    },
  };
}

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
    connected: false,
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
