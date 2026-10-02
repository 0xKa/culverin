import { afterEach, expect, jest, test } from "bun:test";
import {
  analyze,
  cancel,
  startPopup,
} from "../../extension/src/popup/controller";
import type { PopupEvent } from "../../extension/src/popup/state";
import { event, settle } from "./support/events";

const originalChrome = globalThis.chrome;
let dispose: (() => void) | undefined;
afterEach(() => {
  dispose?.();
  dispose = undefined;
  jest.useRealTimers();
  globalThis.chrome = originalChrome;
});

function popup() {
  const events: PopupEvent[] = [];
  const requests: Record<string, unknown>[] = [];
  const messages = event<(value: unknown) => void>();
  const disconnect = event<() => void>();
  globalThis.chrome = {
    runtime: {
      connect: () => ({
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
      }),
    },
    tabs: {
      query: async () => [{ id: 1, url: "https://github.com/culverin/sample" }],
      onUpdated: event(),
      onActivated: event(),
    },
    storage: {
      session: { get: async () => ({}) },
      sync: { get: async () => ({}) },
      onChanged: event(),
    },
  } as unknown as typeof chrome;
  dispose = startPopup((value) => events.push(value));
  const reply = (
    request: Record<string, unknown>,
    value: Record<string, unknown>,
  ) => {
    const { requestId, navigationId, protocolVersion } = request;
    messages.emit({ requestId, navigationId, protocolVersion, ...value });
  };
  return { events, requests, reply, disconnect };
}

test("popup waits beyond a minute for queued and active work, preserves timeout and explicit cancel", async () => {
  jest.useFakeTimers();
  const ui = popup();
  await settle();
  const pending = analyze();
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
    value: "Counting source files locally…",
  });
  ui.reply(request, { type: "analysis.failed", code: "analysis_timeout" });
  await pending;
  expect(
    ui.events.some(
      (item) => item.type === "status" && item.value.includes("interrupted"),
    ),
  ).toBe(false);
  expect(
    ui.events.some(
      (item) => item.type === "status" && item.value.includes("time"),
    ),
  ).toBe(true);
  const canceled = analyze();
  await cancel();
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
