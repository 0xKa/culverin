import { expect, test } from "bun:test";
import {
  CONNECTION_KEY,
  ConnectionStore,
} from "../../extension/src/auth/connection";
import { GrantRejected, type Grant } from "../../extension/src/auth/device";

function memory() {
  const values = new Map<string, unknown>();
  return {
    values,
    get: async (key: string) =>
      values.has(key)
        ? { [key]: structuredClone(values.get(key)) }
        : ({} as Record<string, unknown>),
    set: async (items: Record<string, unknown>) => {
      for (const [key, value] of Object.entries(items))
        values.set(key, structuredClone(value));
    },
  };
}

const hour = 60 * 60_000;

test("a saved connection survives a new store instance", async () => {
  const storage = memory();
  const first = new ConnectionStore(storage, async () => {
    throw new Error("unused");
  });
  const initial = await first.status();
  expect(initial.connected).toBe(false);
  const result = await first.connect({
    method: "token",
    login: "octo",
    token: "github_pat_one",
  });
  expect(result.connected).toBe(true);
  const second = new ConnectionStore(storage, async () => {
    throw new Error("unused");
  });
  expect(await second.status()).toMatchObject({
    connected: true,
    method: "token",
    login: "octo",
    expired: false,
  });
  expect((await second.auth()).token).toBe("github_pat_one");
  expect((await second.status()).generation).not.toBe(initial.generation);
});

test("disconnect removes the token and changes the generation", async () => {
  const storage = memory();
  const store = new ConnectionStore(storage, async () => {
    throw new Error("unused");
  });
  await store.connect({ method: "token", login: "octo", token: "t" });
  const before = await store.generation();
  const { previous, generation } = await store.disconnect();
  expect(previous).toBe(before);
  expect(generation).not.toBe(before);
  expect(await store.auth()).toEqual({ generation });
  expect(JSON.stringify([...storage.values])).not.toContain('"t"');
});

test("a submission started before disconnect cannot connect afterwards", async () => {
  const store = new ConnectionStore(memory(), async () => {
    throw new Error("unused");
  });
  const started = await store.generation();
  await store.disconnect();
  expect(
    await store.connect(
      { method: "token", login: "octo", token: "t" },
      started,
    ),
  ).toEqual({ connected: false });
  expect((await store.status()).connected).toBe(false);
});

test("an expiring app token refreshes once and keeps the generation", async () => {
  let now = 0;
  let calls = 0;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const store = new ConnectionStore(
    memory(),
    async (refreshToken): Promise<Grant> => {
      calls++;
      expect(refreshToken).toBe("ghr_one");
      await gate;
      return {
        token: "ghu_two",
        expiresAt: now + 8 * hour,
        refreshToken: "ghr_two",
        refreshExpiresAt: now + 4000 * hour,
      };
    },
    () => now,
  );
  await store.connect({
    method: "app",
    login: "octo",
    token: "ghu_one",
    expiresAt: 8 * hour,
    refreshToken: "ghr_one",
    refreshExpiresAt: 4000 * hour,
  });
  const generation = await store.generation();
  expect((await store.auth()).token).toBe("ghu_one");
  now = 8 * hour - 60_000;
  const first = store.auth();
  const second = store.auth();
  await Bun.sleep(0);
  release();
  expect(await first).toEqual({ token: "ghu_two", generation });
  expect(await second).toEqual({ token: "ghu_two", generation });
  expect(calls).toBe(1);
  expect((await store.auth()).token).toBe("ghu_two");
});

test("a rejected refresh marks the connection expired", async () => {
  let now = 0;
  const store = new ConnectionStore(
    memory(),
    async () => {
      throw new GrantRejected();
    },
    () => now,
  );
  await store.connect({
    method: "app",
    login: "octo",
    token: "ghu_one",
    expiresAt: hour,
    refreshToken: "ghr_one",
  });
  now = hour;
  expect((await store.auth()).token).toBeUndefined();
  expect(await store.status()).toMatchObject({
    connected: false,
    expired: true,
    method: "app",
    login: "octo",
  });
});

test("a failed network refresh keeps a token that has not expired yet", async () => {
  let now = 0;
  const store = new ConnectionStore(
    memory(),
    async () => {
      throw new Error("offline");
    },
    () => now,
  );
  await store.connect({
    method: "app",
    login: "octo",
    token: "ghu_one",
    expiresAt: hour,
    refreshToken: "ghr_one",
  });
  now = hour - 60_000;
  expect((await store.auth()).token).toBe("ghu_one");
  now = hour;
  expect((await store.auth()).token).toBeUndefined();
  expect((await store.status()).connected).toBe(true);
});

test("a refresh that finishes after disconnect is discarded", async () => {
  let now = 0;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const storage = memory();
  const store = new ConnectionStore(
    storage,
    async () => {
      await gate;
      return { token: "ghu_late", expiresAt: now + hour };
    },
    () => now,
  );
  await store.connect({
    method: "app",
    login: "octo",
    token: "ghu_one",
    expiresAt: hour,
    refreshToken: "ghr_one",
  });
  now = hour;
  const pending = store.auth();
  await Bun.sleep(0);
  const { generation } = await store.disconnect();
  release();
  expect(await pending).toEqual({ generation });
  expect(JSON.stringify(storage.values.get(CONNECTION_KEY))).not.toContain(
    "ghu_late",
  );
});

test("expire only applies to the current generation", async () => {
  const store = new ConnectionStore(memory(), async () => {
    throw new Error("unused");
  });
  await store.connect({ method: "token", login: "octo", token: "t" });
  const old = await store.generation();
  await store.rotate();
  expect(await store.expire(old)).toBe(false);
  expect((await store.status()).connected).toBe(true);
  expect(await store.expire(await store.generation())).toBe(true);
  expect(await store.status()).toMatchObject({
    connected: false,
    expired: true,
  });
});

test("reports an account change when a different login connects", async () => {
  const store = new ConnectionStore(memory(), async () => {
    throw new Error("unused");
  });
  expect(
    await store.connect({ method: "token", login: "octo", token: "t" }),
  ).toMatchObject({ accountChanged: false });
  expect(
    await store.connect({ method: "token", login: "OCTO", token: "u" }),
  ).toMatchObject({ accountChanged: false });
  expect(
    await store.connect({ method: "token", login: "other", token: "v" }),
  ).toMatchObject({ accountChanged: true });
});

test("ignores a malformed stored connection", async () => {
  const storage = memory();
  await storage.set({
    [CONNECTION_KEY]: {
      version: 1,
      generation: crypto.randomUUID(),
      credential: { method: "token", login: "octo", token: "bad token" },
    },
  });
  const store = new ConnectionStore(storage, async () => {
    throw new Error("unused");
  });
  expect((await store.status()).connected).toBe(false);
  expect((await store.auth()).token).toBeUndefined();
});
