import { afterEach, expect, test } from "bun:test";
import {
  validSettingsRequest,
  validSettingsReply,
  type SettingsCommand,
} from "../../extension/src/protocol/settings";
import { sendSettings } from "../../extension/src/settings/client";

const envelope = {
  protocolVersion: 1,
  requestId: "a".repeat(36),
  navigationId: "b".repeat(36),
};
const originalChrome = globalThis.chrome;
afterEach(() => {
  globalThis.chrome = originalChrome;
});
const commands: SettingsCommand[] = [
  ...[
    "auth.status",
    "auth.device.start",
    "auth.device.poll",
    "auth.device.cancel",
    "auth.disconnect",
    "auth.clear-private-session",
    "cache.clear-public",
    "cache.clear-all",
    "analysis.status",
    "rate-limit.check",
  ].map((type) => ({ type }) as SettingsCommand),
  { type: "auth.submit", submissionId: "c".repeat(36) },
  { type: "repository.lookup", owner: "culverin", name: "sample" },
  { type: "analysis.request", owner: "culverin", name: "sample" },
  { type: "analysis.cancel", targetRequestId: "d".repeat(36) },
  { type: "cache.delete", scope: "public", identity: '["1","a"]' },
  { type: "cache.delete", scope: "private", identity: '["1","a"]' },
];

test("trusted command contracts are closed and preserve existing ID acceptance", () => {
  for (const command of commands) {
    expect(validSettingsRequest({ ...envelope, ...command })).toBe(true);
    expect(
      validSettingsRequest({ ...envelope, ...command, token: "forbidden" }),
    ).toBe(false);
  }
  for (const request of [
    { type: "auth.submit" },
    { type: "auth.submit", submissionId: 1 },
    { type: "analysis.cancel" },
    { type: "analysis.request", owner: "../bad", name: "sample" },
    { type: "repository.lookup", owner: "culverin" },
    { type: "cache.delete", scope: "public" },
    { type: "cache.delete", scope: "all", identity: "x" },
    { type: "cache.delete", scope: "public", identity: "" },
    { type: "cache.delete", scope: "public", identity: "x".repeat(1025) },
    { type: "cache.delete", scope: "public", identity: 1 },
    { type: "unknown" },
  ])
    expect(validSettingsRequest({ ...envelope, ...request })).toBe(false);
  expect(
    validSettingsRequest({
      ...envelope,
      type: "auth.status",
      protocolVersion: 2,
    }),
  ).toBe(false);
});

test("replies validate status, polling, generation, safe failure, and correlation", () => {
  const payloads = [
    {
      state: "ok",
      connected: false,
      expired: false,
      generation: "c".repeat(36),
    },
    {
      state: "connected",
      connected: true,
      expired: false,
      generation: "c".repeat(36),
      method: "app",
      login: "octo",
    },
    { state: "pending", retryIn: 5000 },
    { state: "cleared", generation: "c".repeat(36) },
    ...[
      "device-expired",
      "device-missing",
      "device-denied",
      "stale",
      "public-cache-cleared",
      "all-results-cleared",
      "result-deleted",
      "canceled",
      "idle",
      "queued",
      "running",
      "interrupted",
      "busy",
      "checked",
    ].map((state) => ({ state })),
    { state: "failed", code: "network_unavailable" },
  ];
  for (const payload of payloads) {
    const reply = { ...envelope, ...payload };
    expect(
      validSettingsReply(reply, envelope.requestId, envelope.navigationId),
    ).toBe(true);
    expect(
      validSettingsReply(
        { ...reply, token: "forbidden" },
        envelope.requestId,
        envelope.navigationId,
      ),
    ).toBe(false);
    expect(
      validSettingsReply(reply, "d".repeat(36), envelope.navigationId),
    ).toBe(false);
    expect(validSettingsReply(reply, envelope.requestId, "d".repeat(36))).toBe(
      false,
    );
  }
  for (const payload of [
    { state: "pending", retryIn: -1 },
    { state: "ok", connected: true },
    { state: "cleared", generation: 3 },
    { state: "failed", code: "arbitrary" },
  ])
    expect(
      validSettingsReply(
        { ...envelope, ...payload },
        envelope.requestId,
        envelope.navigationId,
      ),
    ).toBe(false);
});

test("settings client builds fresh envelopes and rejects malformed responses and runtime errors", async () => {
  let mode = "ok";
  const requests: Record<string, unknown>[] = [];
  const runtime = {
    lastError: undefined as { message: string } | undefined,
    sendMessage: (
      request: Record<string, unknown>,
      callback: (value: unknown) => void,
    ) => {
      requests.push(request);
      if (mode === "throw") throw new Error("Unavailable");
      runtime.lastError =
        mode === "error" ? { message: "Unavailable" } : undefined;
      callback({
        protocolVersion: 1,
        requestId: mode === "wrong" ? crypto.randomUUID() : request.requestId,
        navigationId: request.navigationId,
        state: "public-cache-cleared",
      });
    },
  };
  globalThis.chrome = { runtime } as unknown as typeof chrome;
  expect((await sendSettings({ type: "cache.clear-public" }))?.state).toBe(
    "public-cache-cleared",
  );
  for (mode of ["wrong", "error", "throw"])
    expect(await sendSettings({ type: "cache.clear-public" })).toBeUndefined();
  expect(new Set(requests.map((request) => request.requestId)).size).toBe(4);
  expect(requests.every(validSettingsRequest)).toBe(true);
});
