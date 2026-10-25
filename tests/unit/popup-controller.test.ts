import { afterEach, expect, jest, test } from "bun:test";
import { createPopupController } from "../../extension/src/popup/controller";
import type { PopupEvent } from "../../extension/src/popup/state";
import { deferred, event, settle } from "./support/events";
import { completedResult } from "./support/result";
import {
  COUNT_FORMAT_KEY,
  SIZE_UNITS_KEY,
} from "../../extension/src/appearance/numbers";
import { initialView, reduce } from "../../extension/src/popup/state";

const originalChrome = globalThis.chrome;
let dispose: (() => void) | undefined;
afterEach(() => {
  dispose?.();
  dispose = undefined;
  jest.useRealTimers();
  globalThis.chrome = originalChrome;
});

function popup(
  query = async () => [{ id: 1, url: "https://github.com/culverin/sample" }],
  holdLookup = false,
  status: Record<string, unknown> = { state: "idle" },
) {
  let connects = 0;
  const events: PopupEvent[] = [];
  const requests: Record<string, unknown>[] = [];
  const messages = event<(value: unknown) => void>();
  const disconnect = event<() => void>();
  const changed =
    event<
      (
        changes: Record<string, chrome.storage.StorageChange>,
        area: string,
      ) => void
    >();
  const activated = event<(info: { tabId: number }) => void>();
  const updated =
    event<(tabId: number, changeInfo: { url?: string }) => void>();
  globalThis.chrome = {
    runtime: {
      connect: () => {
        connects++;
        return {
          onMessage: messages,
          onDisconnect: disconnect,
          disconnect: () => undefined,
          postMessage: (request: Record<string, unknown>) => {
            requests.push(request);
            if (request.type === "repository.lookup" && !holdLookup)
              queueMicrotask(() =>
                messages.emit({
                  protocolVersion: 1,
                  requestId: request.requestId,
                  navigationId: request.navigationId,
                  type: "analysis.failed",
                  code: "network_unavailable",
                }),
              );
            if (request.type === "analysis.status")
              queueMicrotask(() =>
                messages.emit({
                  protocolVersion: 1,
                  requestId: request.requestId,
                  navigationId: request.navigationId,
                  type: "analysis.status",
                  ...status,
                }),
              );
          },
        };
      },
    },
    tabs: {
      query,
      onUpdated: updated,
      onActivated: activated,
    },
    storage: {
      session: { get: async () => ({}) },
      sync: { get: async () => ({}) },
      onChanged: changed,
    },
  } as unknown as typeof chrome;
  const controller = createPopupController((value) => events.push(value));
  controller.start();
  dispose = controller.dispose;
  const reply = (
    request: Record<string, unknown>,
    value: Record<string, unknown>,
  ) => {
    const { requestId, navigationId, protocolVersion } = request;
    messages.emit({ requestId, navigationId, protocolVersion, ...value });
  };
  return {
    events,
    requests,
    reply,
    disconnect,
    changed,
    activated,
    updated,
    controller,
    connects: () => connects,
  };
}

test("popup waits beyond a minute for queued and active work, preserves timeout and explicit cancel", async () => {
  jest.useFakeTimers();
  const ui = popup();
  await settle();
  const pending = ui.controller.analyze();
  await settle();
  const request = ui.requests.find((item) => item.type === "analysis.request")!;
  ui.reply(request, { type: "analysis.progress", phase: "queued" });
  jest.advanceTimersByTime(61_000);
  ui.reply(request, { type: "analysis.progress", phase: "counting" });
  jest.advanceTimersByTime(61_000);
  expect(ui.requests.some((item) => item.type === "analysis.cancel")).toBe(
    false,
  );
  expect(ui.events.at(-1)).toEqual({
    type: "status",
    value: {
      label: "Counting",
      tone: "accent",
      mark: "busy",
      detail: "Counting source files locally…",
    },
  });
  ui.reply(request, await completedResult());
  await pending;
  expect(ui.events.some((item) => item.type === "result")).toBe(true);
  const timedOut = ui.controller.analyze();
  const timeoutRequest = ui.requests.at(-1)!;
  ui.reply(timeoutRequest, {
    type: "analysis.failed",
    code: "analysis_timeout",
  });
  await timedOut;
  expect(
    ui.events.some(
      (item) =>
        item.type === "status" && item.value.detail.includes("interrupted"),
    ),
  ).toBe(false);
  expect(
    ui.events.some(
      (item) => item.type === "status" && item.value.detail.includes("time"),
    ),
  ).toBe(true);
  const canceled = ui.controller.analyze();
  await ui.controller.cancel();
  const second = ui.requests
    .filter((item) => item.type === "analysis.request")
    .at(-1)!;
  expect(ui.requests.at(-1)).toMatchObject({
    type: "analysis.cancel",
    targetRequestId: second.requestId,
  });
  ui.reply(second, { type: "analysis.failed", code: "analysis_canceled" });
  await canceled;
});

test("reformats a retained result during reanalysis without requests or disclosure resets, then stops on navigation", async () => {
  const ui = popup();
  await settle();
  const first = ui.controller.analyze();
  const completed = await completedResult();
  completed.result.totals = {
    lines: 12_480,
    code: 12_480,
    files: 1,
    comments: 0,
    blanks: 0,
  };
  completed.result.languages = [
    {
      language: "TypeScript",
      lines: 12_480,
      code: 12_480,
      files: 1,
      comments: 0,
      blanks: 0,
    },
  ];
  completed.result.coverage = {
    ...completed.result.coverage,
    countedFiles: 1,
    regularFiles: 1,
    analyzedBytes: 1_572_864,
    totalBytes: 1_572_864,
  };
  ui.reply(ui.requests.at(-1)!, completed);
  await first;
  let view = ui.events.reduce(reduce, initialView);
  view = reduce(view, { type: "details", open: false });
  const again = ui.controller.analyze(true);
  const request = ui.requests.at(-1)!;
  const requestCount = ui.requests.length;
  const eventCount = ui.events.length;
  ui.changed.emit(
    {
      [COUNT_FORMAT_KEY]: { newValue: "abbreviated" },
      [SIZE_UNITS_KEY]: { newValue: "decimal" },
    },
    "sync",
  );
  view = ui.events.slice(eventCount).reduce(reduce, view);
  expect(view.result?.codeTotal).toBe("12.5K");
  expect(view.result?.snapshotSize).toBe("1.6 MB");
  expect(view.detailsOpen).toBe(false);
  expect(ui.requests).toHaveLength(requestCount);
  ui.reply(request, { type: "analysis.failed", code: "network_unavailable" });
  await again;
  ui.activated.emit({ tabId: 2 });
  const afterLeaving = ui.events.length;
  ui.changed.emit({ [COUNT_FORMAT_KEY]: { newValue: "full" } }, "sync");
  expect(ui.events).toHaveLength(afterLeaving);
  ui.controller.dispose();
  const afterDisposal = ui.events.length;
  ui.changed.emit({ [SIZE_UNITS_KEY]: { newValue: "binary" } }, "sync");
  expect(ui.events).toHaveLength(afterDisposal);
});

test("holds the popup view until a cached result arrives", async () => {
  jest.useFakeTimers();
  const ui = popup(undefined, true);
  await settle();
  expect(ui.events).toEqual([]);
  const lookup = ui.requests.find((item) => item.type === "repository.lookup")!;
  const { result, resolution } = await completedResult();
  ui.reply(lookup, { type: "repository.cache_hit", result, resolution });
  await settle();
  const reveal = ui.events.findIndex((item) => item.type === "reveal");
  expect(reveal).toBe(ui.events.length - 1);
  expect(ui.events.findIndex((item) => item.type === "result")).toBeLessThan(
    reveal,
  );
  const view = ui.events.reduce(reduce, initialView);
  expect(view.pending).toBe(false);
  expect(view.reanalyze).toBe(true);
  expect(view.status.label).toBe("Cached");
  jest.advanceTimersByTime(200);
  expect(ui.events.filter((item) => item.type === "reveal")).toHaveLength(1);
});

test("reveals the checking state when the lookup is slow", async () => {
  jest.useFakeTimers();
  const ui = popup(undefined, true);
  await settle();
  jest.advanceTimersByTime(199);
  expect(ui.events).toEqual([]);
  jest.advanceTimersByTime(1);
  const view = ui.events.reduce(reduce, initialView);
  expect(view.pending).toBe(false);
  expect(view.repository).toBe("culverin/sample");
  expect(view.status.label).toBe("Checking");
});

test("follows a repository across its sub pages and leaves it elsewhere", async () => {
  for (const [url, left] of [
    ["https://github.com/culverin/sample/releases", false],
    ["https://github.com/culverin/sample?tab=readme-ov-file", false],
    ["https://github.com/Culverin/Sample/tree/main/src", false],
    ["https://github.com/culverin/other/issues", true],
    ["https://github.com/settings/profile", true],
  ] as const) {
    const ui = popup(async () => [
      { id: 1, url: "https://github.com/culverin/sample/issues?q=is%3Aopen" },
    ]);
    await settle();
    expect(ui.events).toContainEqual({
      type: "repository",
      value: "culverin/sample",
    });
    expect(ui.connects()).toBe(1);
    ui.updated.emit(1, { url });
    expect(ui.events.some((value) => value.type === "left")).toBe(left);
    ui.controller.dispose();
  }
});

test("disposing during initialization suppresses late connections and publications", async () => {
  const query = deferred<{ id: number; url: string }[]>();
  const first = popup(() => query.promise);
  first.controller.dispose();
  first.controller.dispose();
  const count = first.events.length;
  const second = popup();
  await settle();
  query.resolve([{ id: 2, url: "https://github.com/other/repo" }]);
  await settle();
  expect(first.events).toHaveLength(count);
  expect(first.connects()).toBe(0);
  expect(second.connects()).toBe(1);
  expect(second.events.filter((event) => event.type === "repository")).toEqual([
    { type: "repository", value: "culverin/sample" },
  ]);
});

test("port interruption settles the active request and disposal sends no cancel", async () => {
  const ui = popup();
  await settle();
  const pending = ui.controller.analyze();
  ui.disconnect.emit();
  await pending;
  expect(
    ui.events.filter(
      (event) =>
        event.type === "status" && event.value.detail.includes("interrupted"),
    ),
  ).toHaveLength(1);
  ui.controller.dispose();
  expect(
    ui.requests.some((request) => request.type === "analysis.cancel"),
  ).toBe(false);
});

function lastStatus(events: PopupEvent[]) {
  const statuses = events.flatMap((item) =>
    item.type === "status" ? [item.value] : [],
  );
  return statuses.at(-1);
}

test("badges summarize outcomes and only waiting failures keep a visible note", async () => {
  jest.useFakeTimers();
  const ui = popup();
  await settle();
  const first = ui.controller.analyze();
  ui.reply(ui.requests.at(-1)!, await completedResult());
  await first;
  expect(lastStatus(ui.events)).toMatchObject({ label: "Fresh", tone: "ok" });

  const again = ui.controller.analyze(true);
  ui.reply(ui.requests.at(-1)!, {
    ...(await completedResult()),
    fromCache: true,
  });
  await again;
  expect(lastStatus(ui.events)).toMatchObject({
    label: "Up to date",
    mark: "done",
  });

  const throttled = ui.controller.analyze();
  ui.reply(ui.requests.at(-1)!, {
    type: "analysis.failed",
    code: "archive_throttled",
  });
  await throttled;
  expect(lastStatus(ui.events)).toMatchObject({
    label: "GitHub busy",
    note: "Try again in a minute",
  });

  for (const [code, label] of [
    ["authentication_required", "No access"],
    ["access_not_granted", "Not shared"],
  ]) {
    const denied = ui.controller.analyze();
    ui.reply(ui.requests.at(-1)!, { type: "analysis.failed", code });
    await denied;
    expect(lastStatus(ui.events)).toMatchObject({ label, tone: "warning" });
  }

  const failed = ui.controller.analyze();
  ui.reply(ui.requests.at(-1)!, {
    type: "analysis.failed",
    code: "download_failed",
  });
  await failed;
  expect(lastStatus(ui.events)).toEqual({
    label: "Failed",
    tone: "error",
    mark: "failed",
    detail: "The source snapshot could not be downloaded.",
  });

  const capped = ui.controller.analyze();
  ui.reply(ui.requests.at(-1)!, {
    type: "analysis.failed",
    code: "auto_download_limit",
    limitBytes: 512 * 1024 * 1024,
  });
  await capped;
  expect(lastStatus(ui.events)).toEqual({
    label: "Too large",
    tone: "warning",
    mark: "failed",
    detail: "Too large to count automatically. Click to count up to 512 MiB.",
  });

  const oversized = ui.controller.analyze();
  ui.reply(ui.requests.at(-1)!, {
    type: "analysis.failed",
    code: "compressed_limit_exceeded",
    limit: "compressed",
    limitBytes: 1024 * 1024 * 1024,
  });
  await oversized;
  expect(lastStatus(ui.events)?.detail).toBe(
    "The source snapshot exceeds the compressed-size limit. The limit is 1 GiB downloaded. You can raise it in Settings → Large repositories.",
  );

  const limited = ui.controller.analyze();
  ui.reply(ui.requests.at(-1)!, {
    type: "analysis.failed",
    code: "rate_limited",
    retryAt: Date.now() + 120_000,
  });
  await limited;
  expect(lastStatus(ui.events)).toMatchObject({
    label: "Rate limited",
    tone: "error",
    detail: expect.stringMatching(/^GitHub rate limit reached\. Retry after /),
    note: expect.stringMatching(/^Available at /),
  });
  jest.advanceTimersByTime(121_000);
  expect(lastStatus(ui.events)).toMatchObject({ label: "Rate limited" });
  expect(lastStatus(ui.events)?.note).toBeUndefined();
});

test("times a running count and says how long it took or ran before stopping", async () => {
  jest.useFakeTimers();
  const ui = popup();
  await settle();
  const view = () => ui.events.reduce(reduce, initialView);
  const last = () => ui.requests.at(-1)!;

  const counted = ui.controller.analyze();
  const request = last();
  ui.reply(request, { type: "analysis.progress", phase: "queued" });
  expect(view().timer).toEqual({ queued: true });
  expect(view().status.detail).toBe("Waiting for another count");
  const startedAt = Date.now() - 5_000;
  ui.reply(request, {
    type: "analysis.progress",
    phase: "downloading",
    startedAt,
  });
  expect(view().timer).toEqual({ startedAt });
  ui.reply(request, { ...(await completedResult()), durationMs: 124_000 });
  await counted;
  expect(view().timer).toBeUndefined();
  expect(view().duration).toBe("Counted in 2m 04s");

  const saved = ui.controller.analyze(true);
  expect(view().duration).toBeUndefined();
  ui.reply(last(), {
    ...(await completedResult()),
    fromCache: true,
    durationMs: 42_000,
  });
  await saved;
  expect(view().duration).toBe("Took 42s when counted");

  const old = ui.controller.analyze(true);
  ui.reply(last(), { ...(await completedResult()), fromCache: true });
  await old;
  expect(view().duration).toBeUndefined();

  const failed = ui.controller.analyze(true);
  const failing = last();
  ui.reply(failing, {
    type: "analysis.progress",
    phase: "counting",
    startedAt: Date.now() - 190_000,
  });
  ui.reply(failing, { type: "analysis.failed", code: "analysis_timeout" });
  await failed;
  expect(view().duration).toBe("Stopped after 3m 10s");

  const early = ui.controller.analyze(true);
  ui.reply(last(), { type: "analysis.failed", code: "network_unavailable" });
  await early;
  expect(view().duration).toBeUndefined();

  void ui.controller.analyze(true);
  ui.reply(last(), {
    type: "analysis.progress",
    phase: "downloading",
    startedAt: Date.now() - 61_000,
  });
  await ui.controller.cancel();
  expect(view().duration).toBe("Stopped after 1m 01s");
  expect(view().timer).toBeUndefined();
});

test("a reopened popup times a running count from when it started", async () => {
  const startedAt = Date.now() - 102_000;
  const ui = popup(undefined, true, { state: "running", startedAt });
  await settle();
  ui.reply(
    ui.requests.find((item) => item.type === "repository.lookup")!,
    {
      type: "repository.not_cached",
    },
  );
  for (let attempt = 0; attempt < 50; attempt++) {
    if (ui.events.some((item) => item.type === "timer")) break;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  const view = ui.events.reduce(reduce, initialView);
  expect(view.cancelVisible).toBe(true);
  expect(view.timer).toEqual({ startedAt });
});

test("a saved result shows how long its count took when known", async () => {
  jest.useFakeTimers();
  for (const [durationMs, text] of [
    [3_000, "Took 3.0s when counted"],
    [undefined, undefined],
  ] as const) {
    const ui = popup(undefined, true);
    await settle();
    const lookup = ui.requests.find(
      (item) => item.type === "repository.lookup",
    )!;
    const { result, resolution } = await completedResult();
    ui.reply(lookup, {
      type: "repository.cache_hit",
      result,
      resolution,
      ...(durationMs === undefined ? {} : { durationMs }),
    });
    await settle();
    expect(ui.events.reduce(reduce, initialView).duration).toBe(text);
    ui.controller.dispose();
  }
});
