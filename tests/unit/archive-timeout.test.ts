import { afterEach, beforeEach, expect, jest, test } from "bun:test";
import { ARCHIVE_TIMEOUTS } from "../../extension/src/archive/limits";
import { abortError, waitFor } from "../../extension/src/archive/timeout";
import {
  analyzeArchive,
  analyzeArchiveStream,
  handleArchiveReply,
} from "../../extension/src/archive/bridge";
import {
  AnalysisCoordinator,
  type AnalysisOutput,
} from "../../extension/src/github/coordinator";
import { result } from "./support/result";

const originalChrome = globalThis.chrome;
const originalFetch = globalThis.fetch;

beforeEach(() => jest.useFakeTimers());
afterEach(() => {
  jest.useRealTimers();
  delete (globalThis as { clients?: unknown }).clients;
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

function bridge(messages: Record<string, unknown>[] = []) {
  const commands: string[] = [];
  globalThis.chrome = {
    runtime: {
      getURL: (path: string) => `chrome-extension://test/${path}`,
      getContexts: async () => [{}],
      sendMessage: async (message: { type: string }) => {
        commands.push(message.type);
        messages.push(message);
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

test("chunks are transferred to the offscreen document instead of copied into messages", async () => {
  const commands = bridge();
  const offscreen = "chrome-extension://test/offscreen.html";
  const posted: { message: Record<string, unknown>; transfer: unknown[] }[] =
    [];
  const ignored: boolean[] = [];
  (globalThis as { clients?: unknown }).clients = {
    matchAll: async () => [
      {
        url: "chrome-extension://test/popup.html",
        postMessage: () => undefined,
      },
      {
        url: offscreen,
        postMessage: (
          message: Record<string, unknown>,
          transfer: unknown[],
        ) => {
          posted.push({ message, transfer });
          const reply = {
            target: "archive.reply",
            jobId: message.jobId,
            sequence: message.sequence,
            response: { state: "ok" },
          };
          queueMicrotask(() => {
            ignored.push(
              handleArchiveReply({
                source: { url: "chrome-extension://test/popup.html" },
                data: reply,
              }),
            );
            handleArchiveReply({ source: { url: offscreen }, data: reply });
          });
        },
      },
    ],
  };
  let source: ReadableStreamDefaultController<Uint8Array>;
  const controller = new AbortController();
  const pending = analyzeArchiveStream(
    new ReadableStream<Uint8Array>({
      start: (value) => {
        source = value;
      },
    }),
    { repositoryId: "1", sha: "a".repeat(40) },
    controller.signal,
    crypto.randomUUID(),
  );
  const rejection = pending.catch((error: unknown) => error);
  await settle();
  const value = new Uint8Array(3 * 1024 * 1024 + 5);
  value[0] = 42;
  source!.enqueue(value);
  for (let index = 0; index < 4; index++) await settle();
  expect(posted.map((item) => item.message.sequence)).toEqual([1, 2, 3, 4]);
  expect(
    posted.map((item) => (item.message.bytes as ArrayBuffer).byteLength),
  ).toEqual([1024 * 1024, 1024 * 1024, 1024 * 1024, 5]);
  expect(posted.every((item) => item.transfer[0] === item.message.bytes)).toBe(
    true,
  );
  expect(new Uint8Array(posted[0]!.message.bytes as ArrayBuffer)[0]).toBe(42);
  expect(value.byteLength).toBe(3 * 1024 * 1024 + 5);
  expect(ignored).toEqual([false, false, false, false]);
  expect(commands).not.toContain("archive.chunk");
  controller.abort("cancel");
  expect(await rejection).toMatchObject({ code: "analysis_canceled" });
});

test("the download check follows the job's limit as it rises", async () => {
  const messages: Record<string, unknown>[] = [];
  bridge(messages);
  let source: ReadableStreamDefaultController<Uint8Array>;
  const limits = { compressed: 4, decompressed: 32 };
  let raise: () => void = () => undefined;
  const pending = analyzeArchiveStream(
    new ReadableStream<Uint8Array>({
      start: (value) => {
        source = value;
      },
    }),
    { repositoryId: "1", sha: "a".repeat(40) },
    new AbortController().signal,
    crypto.randomUUID(),
    0,
    undefined,
    undefined,
    limits,
    (listener) => {
      raise = listener;
    },
  );
  const rejection = pending.catch((error: unknown) => error);
  await settle();
  expect(messages.find((item) => item.type === "archive.start")).toMatchObject({
    limits: { decompressed: 32 },
  });
  source!.enqueue(new Uint8Array(3));
  await settle();
  Object.assign(limits, { compressed: 10, decompressed: 80 });
  raise();
  await settle();
  expect(messages.find((item) => item.type === "archive.limits")).toMatchObject(
    { limits: { decompressed: 80 } },
  );
  source!.enqueue(new Uint8Array(5));
  await settle();
  source!.enqueue(new Uint8Array(5));
  expect(await rejection).toMatchObject({
    code: "compressed_limit_exceeded",
    limit: "compressed",
    limitBytes: 10,
  });
  expect(messages.filter((item) => item.type === "archive.chunk")).toHaveLength(
    2,
  );
});

test("a finished archive reports how long it waited for GitHub and for the counter", async () => {
  const counted = await result("1");
  let acknowledge: () => void = () => undefined;
  globalThis.chrome = {
    runtime: {
      getURL: (path: string) => `chrome-extension://test/${path}`,
      getContexts: async () => [{}],
      sendMessage: async (message: { type: string }) => {
        if (message.type === "archive.start") return { state: "started" };
        if (message.type === "archive.chunk")
          return new Promise((resolve) => {
            acknowledge = () => resolve({ state: "ok" });
          });
        if (message.type === "archive.finish")
          return {
            state: "completed",
            result: counted,
            metrics: {
              decompressedBytes: 0,
              entries: 0,
              regularFiles: 0,
              specialEntries: 0,
              wasmBytes: 0,
              retainedPathBytes: 0,
            },
            wasmLinearMemoryBytes: 0,
          };
        return { state: "ok" };
      },
    },
  } as unknown as typeof chrome;
  let source: ReadableStreamDefaultController<Uint8Array>;
  const body = new ReadableStream<Uint8Array>({
    start: (value) => {
      source = value;
    },
  });
  globalThis.fetch = (async () => {
    await new Promise((resolve) => setTimeout(resolve, 1_000));
    const response = new Response(body, { status: 200 });
    Object.defineProperty(response, "url", {
      value: `https://codeload.github.com/culverin/fixture/legacy.tar.gz/${"a".repeat(40)}`,
    });
    return response;
  }) as unknown as typeof fetch;
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
  await settle();
  jest.advanceTimersByTime(1_000);
  for (let index = 0; index < 3; index++) await settle();
  jest.advanceTimersByTime(3_000);
  source!.enqueue(new Uint8Array(4));
  await settle();
  jest.advanceTimersByTime(5_000);
  acknowledge();
  await settle();
  jest.advanceTimersByTime(2_000);
  source!.close();
  const output = await pending;
  expect(output.githubWaitMs).toBe(6_000);
  expect(output.counterWaitMs).toBe(5_000);
});

test("download progress reports the file count from the last chunk acknowledgement", async () => {
  const counts: unknown[] = [4, "many", 9];
  globalThis.chrome = {
    runtime: {
      getURL: (path: string) => `chrome-extension://test/${path}`,
      getContexts: async () => [{}],
      sendMessage: async (message: { type: string }) =>
        message.type === "archive.start"
          ? { state: "started" }
          : message.type === "archive.chunk"
            ? { state: "ok", files: counts.shift() }
            : { state: "ok" },
    },
  } as unknown as typeof chrome;
  let source: ReadableStreamDefaultController<Uint8Array>;
  const seen: unknown[] = [];
  const controller = new AbortController();
  const pending = analyzeArchiveStream(
    new ReadableStream<Uint8Array>({
      start: (value) => {
        source = value;
      },
    }),
    { repositoryId: "1", sha: "a".repeat(40) },
    controller.signal,
    crypto.randomUUID(),
    0,
    (_phase, bytes, files) => seen.push([bytes, files]),
  );
  const rejection = pending.catch((error: unknown) => error);
  await settle();
  for (let index = 0; index < 4; index++) {
    source!.enqueue(new Uint8Array([index]));
    await settle();
  }
  expect(seen).toEqual([
    [0, undefined],
    [1, undefined],
    [2, 4],
    [3, 4],
    [4, 9],
  ]);
  controller.abort("cancel");
  expect(await rejection).toMatchObject({ code: "analysis_canceled" });
});
