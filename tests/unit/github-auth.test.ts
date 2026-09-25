import { expect, test } from "bun:test";
import {
  activatePending,
  activeToken,
  authStatus,
  clearPrivateSession,
  disconnect,
  initializeSession,
} from "../../extension/src/auth/session";
import { pendingKey } from "../../extension/src/auth/pending";
import type { Fetcher } from "../../extension/src/github/client";

const values = new Map<string, unknown>();
let accessLevel: string | undefined;

const session = {
  setAccessLevel: async (value: { accessLevel: string }) => {
    accessLevel = value.accessLevel;
  },
  get: async (keys: string | string[]) => {
    const result: Record<string, unknown> = {};
    for (const key of Array.isArray(keys) ? keys : [keys])
      if (values.has(key)) result[key] = values.get(key);
    return result;
  },
  set: async (entries: Record<string, unknown>) => {
    for (const [key, value] of Object.entries(entries)) values.set(key, value);
  },
  remove: async (keys: string | string[]) => {
    for (const key of Array.isArray(keys) ? keys : [keys]) values.delete(key);
  },
};

(globalThis as unknown as { chrome: unknown }).chrome = {
  storage: { session },
};

function response(body: string, url: string): Response {
  const result = new Response(body);
  Object.defineProperty(result, "url", { value: url });
  return result;
}

test("disconnect invalidates an in-flight token submission", async () => {
  values.clear();
  await initializeSession();
  expect(accessLevel).toBe("TRUSTED_CONTEXTS");
  const generation = (await authStatus()).generation;
  const submissionId = crypto.randomUUID();
  await session.set({
    [pendingKey]: {
      token: "test-token",
      submissionId,
      generation,
      owner: "owner",
      name: "selected",
      createdAt: Date.now(),
    },
  });
  let release!: () => void;
  const hold = new Promise<void>((resolve) => {
    release = resolve;
  });
  let started!: () => void;
  const began = new Promise<void>((resolve) => {
    started = resolve;
  });
  let calls = 0;
  const fetcher: Fetcher = async () => {
    calls++;
    if (calls === 1) {
      started();
      await hold;
      return response(
        JSON.stringify({
          id: 9,
          name: "selected",
          owner: { login: "owner" },
          private: true,
          default_branch: "main",
        }),
        "https://api.github.com/repos/owner/selected",
      );
    }
    return response(
      JSON.stringify({ sha: "a".repeat(40) }),
      "https://api.github.com/repos/owner/selected/commits/main",
    );
  };
  const activation = activatePending(submissionId, fetcher);
  await began;
  await disconnect();
  release();
  expect(await activation).toEqual({ connected: false });
  expect((await authStatus()).connected).toBe(false);
  expect((await activeToken()).token).toBeUndefined();
  expect(values.has(pendingKey)).toBe(false);
});

test("successful activation is session-only and restart transition clears it", async () => {
  values.clear();
  await initializeSession();
  const generation = (await authStatus()).generation;
  const submissionId = crypto.randomUUID();
  await session.set({
    [pendingKey]: {
      token: "test-token",
      submissionId,
      generation,
      owner: "owner",
      name: "selected",
      createdAt: Date.now(),
    },
  });
  let calls = 0;
  const fetcher: Fetcher = async () => {
    calls++;
    return calls === 1
      ? response(
          JSON.stringify({
            id: 9,
            name: "selected",
            owner: { login: "owner" },
            private: true,
            default_branch: "main",
          }),
          "https://api.github.com/repos/owner/selected",
        )
      : response(
          JSON.stringify({ sha: "a".repeat(40) }),
          "https://api.github.com/repos/owner/selected/commits/main",
        );
  };
  expect((await activatePending(submissionId, fetcher)).connected).toBe(true);
  expect((await activeToken()).token).toBe("test-token");
  expect(values.has(pendingKey)).toBe(false);
  const beforeClear = (await authStatus()).generation;
  await clearPrivateSession();
  expect((await activeToken()).token).toBe("test-token");
  expect((await authStatus()).generation).not.toBe(beforeClear);
  await session.set({ "github.transition": true });
  await initializeSession();
  expect((await activeToken()).token).toBeUndefined();
});
