import { afterEach, beforeEach, expect, jest, test } from "bun:test";
import { ARCHIVE_TIMEOUTS } from "../../extension/src/archive/limits";
import { abortError, waitFor } from "../../extension/src/archive/timeout";
import {
  analyzeArchive,
  analyzeArchiveStream,
} from "../../extension/src/archive/bridge";
import {
  AnalysisCoordinator,
  type AnalysisOutput,
} from "../../extension/src/github/coordinator";

const originalChrome = globalThis.chrome;
const originalFetch = globalThis.fetch;

beforeEach(() => jest.useFakeTimers());
afterEach(() => {
  jest.useRealTimers();
  globalThis.chrome = originalChrome;
  globalThis.fetch = originalFetch;
});

test("a stalled operation times out without waiting for its promise", async () => {
  const pending = waitFor(
    new Promise(() => undefined),
    new AbortController().signal,
    30_000,
  );
  const rejection = pending.catch((error: unknown) => error);
  jest.advanceTimersByTime(30_000);
  expect(await rejection).toMatchObject({ code: "analysis_timeout" });
  expect(jest.getTimerCount()).toBe(0);
});

test("settlement removes the watchdog and preserves the operation error", async () => {
  const signal = new AbortController().signal;
  expect(await waitFor(Promise.resolve(42), signal, 30_000)).toBe(42);
  await expect(
    waitFor(Promise.reject(new Error("failed")), signal, 30_000),
  ).rejects.toThrow("failed");
  expect(jest.getTimerCount()).toBe(0);
});

test("cancel and deadline aborts promptly end a pending operation", async () => {
  for (const [reason, code] of [
    ["cancel", "analysis_canceled"],
    ["deadline", "analysis_timeout"],
  ] as const) {
    const controller = new AbortController();
    const pending = waitFor(
      new Promise(() => undefined),
      controller.signal,
      30_000,
    );
    const rejection = pending.catch((error: unknown) => error);
    controller.abort(reason);
    expect(await rejection).toMatchObject({ code });
    expect(abortError(controller.signal).code).toBe(code);
  }
  expect(jest.getTimerCount()).toBe(0);
});

function bridge() {
  const commands: string[] = [];
  globalThis.chrome = {
    runtime: {
      getURL: (path: string) => `chrome-extension://test/${path}`,
      getContexts: async () => [{}],
      sendMessage: async (message: { type: string }) => {
        commands.push(message.type);
        return { state: message.type === "archive.start" ? "started" : "ok" };
      },
    },
  } as unknown as typeof chrome;
  return commands;
}

async function settle(): Promise<void> {
  for (let index = 0; index < 10; index++) await Promise.resolve();
}

test("a network stall cancels the source reader and the worker job", async () => {
  const commands = bridge();
  let canceled = false;
  const stream = new ReadableStream<Uint8Array>({
    pull: () => new Promise(() => undefined),
    cancel: () => {
      canceled = true;
    },
  });
  const pending = analyzeArchiveStream(
    stream,
    { repositoryId: "1", sha: "a".repeat(40) },
    new AbortController().signal,
    crypto.randomUUID(),
  );
  const rejection = pending.catch((error: unknown) => error);
  await settle();
  jest.advanceTimersByTime(ARCHIVE_TIMEOUTS.networkIdle);
  expect(await rejection).toMatchObject({ code: "analysis_timeout" });
  expect(canceled).toBe(true);
  expect(commands).toContain("archive.cancel");
});

test("fresh network bytes extend the read watchdog beyond 25 seconds", async () => {
  const commands = bridge();
  let source: ReadableStreamDefaultController<Uint8Array>;
  const stream = new ReadableStream<Uint8Array>({
    start: (value) => {
      source = value;
    },
  });
  const controller = new AbortController();
  const pending = analyzeArchiveStream(
    stream,
    { repositoryId: "1", sha: "a".repeat(40) },
    controller.signal,
    crypto.randomUUID(),
  );
  const rejection = pending.catch((error: unknown) => error);
  await settle();
  for (let index = 0; index < 3; index++) {
    jest.advanceTimersByTime(26_000);
    source!.enqueue(new Uint8Array([1]));
    await settle();
  }
  expect(commands.filter((type) => type === "archive.chunk")).toHaveLength(3);
  controller.abort("cancel");
  expect(await rejection).toMatchObject({ code: "analysis_canceled" });
});

test("an overall deadline keeps its timeout reason during a pending read", async () => {
  bridge();
  const controller = new AbortController();
  const pending = analyzeArchiveStream(
    new ReadableStream(),
    { repositoryId: "1", sha: "a".repeat(40) },
    controller.signal,
    crypto.randomUUID(),
  );
  const rejection = pending.catch((error: unknown) => error);
  await settle();
  controller.abort("deadline");
  expect(await rejection).toMatchObject({ code: "analysis_timeout" });
});

test("a stalled archive response aborts its fetch before starting a worker", async () => {
  const commands = bridge();
  let downloadSignal: AbortSignal | undefined;
  globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    downloadSignal = init?.signal ?? undefined;
    return new Promise<Response>((_resolve, reject) => {
      downloadSignal?.addEventListener(
        "abort",
        () => reject(new Error("aborted")),
        { once: true },
      );
    });
  }) as typeof fetch;
  const pending = analyzeArchive(
    {
      repositoryId: "1",
      owner: "culverin",
      name: "fixture",
      defaultBranch: "main",
      visibility: "public",
      sha: "a".repeat(40),
      sizeKb: null,
    },
    undefined,
    new AbortController().signal,
    crypto.randomUUID(),
  );
  const rejection = pending.catch((error: unknown) => error);
  jest.advanceTimersByTime(ARCHIVE_TIMEOUTS.networkIdle);
  expect(await rejection).toMatchObject({ code: "analysis_timeout" });
  expect(downloadSignal?.aborted).toBe(true);
  expect(commands).not.toContain("archive.start");
});

test("the coordinator gives active and queued jobs their longer allowances", async () => {
  const signals: AbortSignal[] = [];
  const failures: unknown[] = [];
  const coordinator = new AnalysisCoordinator(
    (job) => {
      signals.push(job.signal);
      return new Promise<AnalysisOutput>((_resolve, reject) => {
        job.signal.addEventListener(
          "abort",
          () => reject(new Error("stopped")),
          { once: true },
        );
      });
    },
    () => undefined,
  );
  for (let index = 0; index < 2; index++) {
    const owner = String(index);
    expect(
      coordinator.subscribe(
        owner,
        {
          repositoryId: String(index + 1),
          owner: "culverin",
          name: "fixture",
          defaultBranch: "main",
          visibility: "public",
          sha: "a".repeat(40),
          sizeKb: null,
          resolvedAt: Date.now(),
        },
        undefined,
        "",
        {
          requestId: crypto.randomUUID(),
          owner,
          public: true,
          onProgress: () => undefined,
          onComplete: () => undefined,
          onFailure: (_error, signal) => failures.push(signal.reason),
        },
      ),
    ).toBe(true);
  }
  jest.advanceTimersByTime(31_000);
  expect(signals[0]?.aborted).toBe(false);
  expect(coordinator.status("1")).toBe("queued");
  expect(failures).toEqual([]);
  jest.advanceTimersByTime(ARCHIVE_TIMEOUTS.job - 31_000);
  await settle();
  expect(signals[0]?.reason).toBe("deadline");
  expect(coordinator.status("1")).toBe("idle");
  expect(failures).toContain("deadline");
  expect(coordinator.subscriptionCount()).toBe(0);
});
