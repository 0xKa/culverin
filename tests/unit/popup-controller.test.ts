import { afterEach, expect, jest, test } from "bun:test";
import { createPopupController } from "../../extension/src/popup/controller";
import type { PopupEvent } from "../../extension/src/popup/state";
import { deferred, event, settle } from "./support/events";
import { completedResult } from "./support/result";

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
) {
  let connects = 0;
  const events: PopupEvent[] = [];
  const requests: Record<string, unknown>[] = [];
  const messages = event<(value: unknown) => void>();
  const disconnect = event<() => void>();
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
            if (request.type === "repository.lookup")
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
                  state: "idle",
                }),
              );
          },
        };
      },
    },
    tabs: {
      query,
      onUpdated: event(),
      onActivated: event(),
    },
    storage: {
      session: { get: async () => ({}) },
      sync: { get: async () => ({}) },
      onChanged: event(),
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
