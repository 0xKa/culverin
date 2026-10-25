import { afterEach, beforeEach, expect, jest, test } from "bun:test";
import { encodeChunk } from "../../extension/src/archive/bridge";
import {
  archiveHostActive,
  handleArchiveData,
  handleArchiveHost,
  stopArchive,
} from "../../extension/src/archive/host";
import { ARCHIVE_TIMEOUTS } from "../../extension/src/archive/limits";

const originalWorker = globalThis.Worker;
const originalChrome = globalThis.chrome;
const workers: FakeWorker[] = [];
const latest = () => workers.at(-1)!;

class FakeWorker {
  onmessage?: (event: MessageEvent) => void;
  onerror?: () => void;
  terminated = false;
  messages: unknown[] = [];
  constructor() {
    workers.push(this);
  }
  postMessage(message: unknown) {
    this.messages.push(message);
  }
  terminate() {
    this.terminated = true;
  }
  emit(value: unknown) {
    this.onmessage?.({ data: value } as MessageEvent);
  }
}

beforeEach(() => {
  workers.length = 0;
  jest.useFakeTimers();
  globalThis.Worker = FakeWorker as unknown as typeof Worker;
  globalThis.chrome = {
    runtime: {
      id: "test",
      getURL: (path: string) => `chrome-extension://test/${path}`,
      sendMessage: async () => undefined,
    },
  } as unknown as typeof chrome;
});

afterEach(() => {
  stopArchive();
  jest.useRealTimers();
  globalThis.Worker = originalWorker;
  globalThis.chrome = originalChrome;
});

function start(finishNow = true) {
  const jobId = crypto.randomUUID();
  const send = (
    type: string,
    respond: (value: unknown) => void = () => undefined,
    extra: Record<string, unknown> = {},
  ) =>
    handleArchiveHost(
      { target: "archive.host", protocolVersion: 1, jobId, type, ...extra },
      { id: "test", url: "chrome-extension://test/background.js" },
      respond,
      false,
    );
  const started = jest.fn();
  send("archive.start", started, {
    blockMs: 0,
    limits: { decompressed: 2 * 1024 ** 3 },
    rules: {
      repositoryId: "1",
      commitSha: "a".repeat(40),
      disabledGroups: [],
      exclusions: [],
    },
  });
  expect(started).toHaveBeenCalledWith({ state: "started" });
  const finish = jest.fn();
  if (finishNow) send("archive.finish", finish);
  return { send, finish, jobId };
}

function advance(
  send: ReturnType<typeof start>["send"],
  milliseconds: number,
  progress = false,
) {
  for (let elapsed = 0; elapsed < milliseconds; elapsed += 1000) {
    send("archive.renew");
    if (progress) latest().emit({ type: "activity" });
    jest.advanceTimersByTime(Math.min(1000, milliseconds - elapsed));
  }
}

test("lease renewals do not disguise a stalled analysis", () => {
  const { send, finish } = start();
  advance(send, ARCHIVE_TIMEOUTS.workerIdle);
  expect(latest().terminated).toBe(true);
  expect(archiveHostActive()).toBe(false);
  expect(finish).toHaveBeenCalledWith({
    state: "failed",
    code: "analysis_timeout",
  });
});

test("real work may continue beyond 25 seconds but stops at the overall deadline", () => {
  const { send, finish } = start();
  advance(send, ARCHIVE_TIMEOUTS.job - 1000, true);
  expect(archiveHostActive()).toBe(true);
  expect(finish).not.toHaveBeenCalled();
  advance(send, 1000, true);
  expect(latest().terminated).toBe(true);
  expect(finish).toHaveBeenCalledWith({
    state: "failed",
    code: "analysis_timeout",
  });
});

test("missing service-worker leases terminate an orphaned job", () => {
  const { finish } = start();
  jest.advanceTimersByTime(ARCHIVE_TIMEOUTS.lease);
  expect(latest().terminated).toBe(true);
  expect(finish).toHaveBeenCalledWith({ state: "interrupted" });
});

test("cancel terminates a blocked worker without waiting for progress", () => {
  const { send, finish } = start();
  latest().emit({ type: "counting" });
  send("archive.cancel");
  expect(latest().terminated).toBe(true);
  expect(finish).toHaveBeenCalledWith({ state: "canceled" });
  expect(jest.getTimerCount()).toBe(0);
});

test("startup reconciliation interrupts an orphan and leaves the host ready for a new job", () => {
  const { send, finish } = start();
  const orphan = latest();
  const respond = jest.fn();
  send("archive.reconcile", respond);
  expect(orphan.terminated).toBe(true);
  expect(finish).toHaveBeenCalledWith({ state: "interrupted" });
  expect(respond).toHaveBeenCalledWith({ ok: true });
  expect(archiveHostActive()).toBe(false);
  expect(jest.getTimerCount()).toBe(0);
  start();
  expect(latest()).not.toBe(orphan);
  expect(archiveHostActive()).toBe(true);
});

function chunks() {
  return latest().messages.filter(
    (
      message,
    ): message is { type: "chunk"; sequence: number; bytes: Uint8Array } =>
      (message as { type?: string }).type === "chunk",
  );
}

test("base64 chunks reach the worker in sequence", () => {
  const { send } = start(false);
  const respond = jest.fn();
  expect(
    send("archive.chunk", respond, {
      sequence: 1,
      bytes: encodeChunk(new Uint8Array([0, 1, 254, 255])),
    }),
  ).toBe(true);
  expect(chunks()).toHaveLength(1);
  expect([...chunks()[0]!.bytes]).toEqual([0, 1, 254, 255]);
  latest().emit({ type: "ack", sequence: 1 });
  expect(respond).toHaveBeenCalledWith({ state: "ok" });
});

test("chunk acknowledgements carry the worker's file count only when it is valid", () => {
  const { send } = start(false);
  const cases = [
    [3, { state: "ok", files: 3 }],
    [-1, { state: "ok" }],
    [1.5, { state: "ok" }],
    [1_000_001, { state: "ok" }],
    ["3", { state: "ok" }],
  ] as const;
  cases.forEach(([files, response], index) => {
    const respond = jest.fn();
    send("archive.chunk", respond, {
      sequence: index + 1,
      bytes: encodeChunk(new Uint8Array([index])),
    });
    latest().emit({ type: "ack", sequence: index + 1, files });
    expect(respond).toHaveBeenCalledWith(response);
  });
});

test("malformed, oversized, and out-of-order base64 chunks are rejected", () => {
  const { send } = start(false);
  for (const extra of [
    { sequence: 1, bytes: [1, 2, 3] },
    { sequence: 1, bytes: "not base64!" },
    { sequence: 1, bytes: "QUJD=" },
    { sequence: 1, bytes: encodeChunk(new Uint8Array(1024 * 1024 + 1)) },
    { sequence: 2, bytes: encodeChunk(new Uint8Array([1])) },
  ]) {
    const respond = jest.fn();
    expect(send("archive.chunk", respond, extra)).toBe(false);
    expect(respond).toHaveBeenCalledWith({
      state: "failed",
      code: "archive_invalid",
    });
  }
  expect(chunks()).toHaveLength(0);
});

function serviceWorker(scriptURL = "chrome-extension://test/background.js") {
  const replies: unknown[] = [];
  return {
    replies,
    source: { scriptURL, postMessage: (value: unknown) => replies.push(value) },
  };
}

test("transferred chunks from the extension service worker reach the worker", () => {
  const { jobId } = start(false);
  const { replies, source } = serviceWorker();
  const buffer = new Uint8Array([7, 8, 9]).buffer;
  expect(
    handleArchiveData({
      source,
      data: {
        target: "archive.data",
        protocolVersion: 1,
        jobId,
        sequence: 1,
        bytes: buffer,
      },
    }),
  ).toBe(true);
  expect(chunks()[0]!.bytes.buffer).toBe(buffer);
  latest().emit({ type: "ack", sequence: 1 });
  expect(replies).toEqual([
    { target: "archive.reply", jobId, sequence: 1, response: { state: "ok" } },
  ]);
});

test("data from another source, job, or sequence is not accepted", () => {
  const { jobId } = start(false);
  const data = (extra: Record<string, unknown> = {}) => ({
    target: "archive.data",
    protocolVersion: 1,
    jobId,
    sequence: 1,
    bytes: new Uint8Array([1]).buffer,
    ...extra,
  });
  const stranger = serviceWorker("https://example.com/background.js");
  expect(handleArchiveData({ source: stranger.source, data: data() })).toBe(
    false,
  );
  expect(handleArchiveData({ source: null, data: data() })).toBe(false);
  expect(stranger.replies).toEqual([]);
  const own = serviceWorker();
  handleArchiveData({
    source: own.source,
    data: data({ jobId: crypto.randomUUID() }),
  });
  handleArchiveData({ source: own.source, data: data({ sequence: 2 }) });
  handleArchiveData({ source: own.source, data: data({ bytes: [1] }) });
  expect(
    own.replies.map((reply) => (reply as { response: unknown }).response),
  ).toEqual([
    { state: "interrupted" },
    { state: "failed", code: "archive_invalid" },
    { state: "failed", code: "archive_invalid" },
  ]);
  expect(chunks()).toHaveLength(0);
});

test("a job starts only with a valid unpacked limit", () => {
  for (const limits of [
    undefined,
    {},
    { decompressed: 0 },
    { decompressed: 32 * 1024 ** 3 + 1 },
    { decompressed: 1024, compressed: 1024 },
  ]) {
    const respond = jest.fn();
    handleArchiveHost(
      {
        target: "archive.host",
        protocolVersion: 1,
        jobId: crypto.randomUUID(),
        type: "archive.start",
        blockMs: 0,
        limits,
        rules: {
          repositoryId: "1",
          commitSha: "a".repeat(40),
          disabledGroups: [],
          exclusions: [],
        },
      },
      { id: "test", url: "chrome-extension://test/background.js" },
      respond,
      false,
    );
    expect(respond).toHaveBeenCalledWith({
      state: "failed",
      code: "analysis_busy",
    });
  }
  expect(archiveHostActive()).toBe(false);
});

test("a running job's unpacked limit can rise but never fall", () => {
  const { send } = start(false);
  expect(latest().messages[0]).toMatchObject({
    type: "start",
    decompressed: 2 * 1024 ** 3,
  });
  const raised = jest.fn();
  send("archive.limits", raised, { limits: { decompressed: 4 * 1024 ** 3 } });
  send("archive.limits", jest.fn(), { limits: { decompressed: 1024 } });
  expect(raised).toHaveBeenCalledWith({ state: "ok" });
  expect(latest().messages.slice(1)).toEqual([
    { type: "limits", decompressed: 4 * 1024 ** 3 },
    { type: "limits", decompressed: 4 * 1024 ** 3 },
  ]);
  latest().emit({
    type: "result",
    ok: false,
    code: "decompressed_limit_exceeded",
    limit: "decompressed",
    limitBytes: 4 * 1024 ** 3,
  });
  const finish = jest.fn();
  send("archive.finish", finish);
  expect(finish).toHaveBeenCalledWith({
    state: "failed",
    code: "decompressed_limit_exceeded",
    limit: "decompressed",
    limitBytes: 4 * 1024 ** 3,
  });
});
