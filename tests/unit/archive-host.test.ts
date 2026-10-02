import { afterEach, beforeEach, expect, jest, test } from "bun:test";
import {
  archiveHostActive,
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
  constructor() {
    workers.push(this);
  }
  postMessage() {}
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

function start() {
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
    rules: {
      repositoryId: "1",
      commitSha: "a".repeat(40),
      disabledGroups: [],
      exclusions: [],
    },
  });
  expect(started).toHaveBeenCalledWith({ state: "started" });
  const finish = jest.fn();
  send("archive.finish", finish);
  return { send, finish };
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
