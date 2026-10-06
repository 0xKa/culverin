import { afterEach, beforeAll, expect, jest, test } from "bun:test";
import { resolve } from "node:path";
import type { RowAction, RowState } from "../../extension/src/content/ui";
import { event, settle } from "./support/events";
import { completedResult } from "./support/result";

let source: string;
beforeAll(async () => {
  const build = await Bun.build({
    entrypoints: ["extension/src/content/main.ts"],
    target: "browser",
    format: "iife",
    plugins: [
      {
        name: "page-renderer-fixture",
        setup(builder) {
          builder.onResolve({ filter: /^\.\/ui$/ }, () => ({
            path: "ui",
            namespace: "fixture",
          }));
          builder.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({
            loader: "js",
            contents: `export { failureState, lookupFailureState } from ${JSON.stringify(resolve("extension/src/content/ui.ts"))}; export const createSummaryUi = (activate) => window.fixture.create(activate); export const showState = (ui, state) => window.fixture.show(state);`,
          }));
        },
      },
    ],
  });
  expect(build.success).toBe(true);
  source = await build.outputs[0]!.text();
});
afterEach(() => jest.useRealTimers());

function pageHarness() {
  jest.useFakeTimers();
  const states: RowState[] = [];
  let activate!: (action: RowAction) => void;
  const requests: Record<string, unknown>[] = [];
  const callbacks = new Map<string, (value: unknown) => void>();
  const messages = event<(message: unknown, sender: unknown) => void>();
  const ports: {
    disconnect: ReturnType<typeof jest.fn>;
    onDisconnect: ReturnType<typeof event<() => void>>;
    connected: boolean;
  }[] = [];
  const lifecycle = new Map<string, () => void>();
  const runtime = {
    id: "test",
    getURL: (path: string) => `chrome-extension://test/${path}`,
    connect: jest.fn(() => {
      const port = {
        connected: true,
        onDisconnect: event<() => void>(),
        disconnect: jest.fn(() => {
          port.connected = false;
          port.onDisconnect.emit();
        }),
      };
      ports.push(port);
      return port;
    }),
    onMessage: messages,
    sendMessage: (
      request: Record<string, unknown>,
      callback: (value: unknown) => void,
    ) => {
      requests.push(request);
      callbacks.set(request.requestId as string, callback);
      if (!ports.at(-1)?.connected)
        callback({
          protocolVersion: 1,
          requestId: request.requestId,
          navigationId: request.navigationId,
          type: "analysis.failed",
          code: "analysis_interrupted",
        });
      else if (request.type === "repository.lookup")
        callback({
          protocolVersion: 1,
          requestId: request.requestId,
          navigationId: request.navigationId,
          type: "repository.not_cached",
        });
    },
  };
  const document = {
    readyState: "complete",
    querySelectorAll: () => [],
    querySelector: () => ({ getAttribute: () => "culverin/sample" }),
  };
  const window = {
    addEventListener: (type: string, listener: () => void) =>
      lifecycle.set(type, listener),
    fixture: {
      create: (action: typeof activate) => {
        activate = action;
        return { host: { remove: () => undefined, isConnected: true } };
      },
      show: (state: RowState) => states.push(state),
    },
  };
  const run = new Function(
    "chrome",
    "location",
    "document",
    "window",
    "MutationObserver",
    source,
  );
  run(
    { runtime },
    new URL("https://github.com/culverin/sample"),
    document,
    window,
    class {
      observe() {}
      disconnect() {}
    },
  );
  return {
    states,
    activate: (action: RowAction) => activate(action),
    requests,
    callbacks,
    messages,
    ports,
    runtime,
    lifecycle,
  };
}

test("page analysis allows sparse progress beyond one minute and ends on engine or transport failure", async () => {
  const { states, activate, requests, callbacks, messages, ports, runtime } =
    pageHarness();
  await settle();
  activate("analyze");
  const request = requests.at(-1)!;
  const envelope = {
    protocolVersion: 1,
    requestId: request.requestId,
    navigationId: request.navigationId,
  };
  messages.emit(
    { ...envelope, type: "analysis.progress", phase: "counting" },
    { id: "test", url: runtime.getURL("background.js") },
  );
  jest.advanceTimersByTime(122_000);
  expect(requests.some((value) => value.type === "analysis.cancel")).toBe(
    false,
  );
  expect(states.at(-1)).toEqual({ kind: "running", phase: "counting" });
  callbacks.get(request.requestId as string)!({
    ...envelope,
    ...(await completedResult()),
  });
  await settle();
  expect(states.at(-1)).toMatchObject({ kind: "complete", total: 0 });
  activate("analyze");
  const timedOut = requests.at(-1)!;
  callbacks.get(timedOut.requestId as string)!({
    protocolVersion: 1,
    requestId: timedOut.requestId,
    navigationId: timedOut.navigationId,
    type: "analysis.failed",
    code: "analysis_timeout",
  });
  await settle();
  expect(states.at(-1)).toMatchObject({
    kind: "retry",
    detail: expect.stringContaining("time"),
  });
  activate("analyze");
  ports.at(-1)!.disconnect();
  expect(states.at(-1)).toMatchObject({
    kind: "retry",
    detail: expect.stringContaining("interrupted"),
  });
});

test("completed page counts survive disconnect and reconnect only on the next action", async () => {
  const { states, activate, requests, callbacks, ports, runtime, lifecycle } =
    pageHarness();
  await settle();
  activate("analyze");
  const request = requests.at(-1)!;
  callbacks.get(request.requestId as string)!({
    protocolVersion: 1,
    requestId: request.requestId,
    navigationId: request.navigationId,
    ...(await completedResult()),
  });
  await settle();
  const completed = states.at(-1);
  expect(completed).toMatchObject({ kind: "complete", total: 0 });
  const oldPort = ports[0]!;
  oldPort.disconnect();
  jest.advanceTimersByTime(60_000);
  await settle();
  expect(states.at(-1)).toEqual(completed);
  expect(runtime.connect).toHaveBeenCalledTimes(1);
  expect(requests).toHaveLength(2);
  activate("analyze");
  expect(runtime.connect).toHaveBeenCalledTimes(2);
  expect(runtime.connect).toHaveBeenLastCalledWith({ name: "culverin.public" });
  const retry = requests.at(-1)!;
  expect(retry.type).toBe("analysis.request");
  oldPort.onDisconnect.emit();
  expect(states.at(-1)).toEqual({ kind: "running", phase: "resolving" });
  callbacks.get(retry.requestId as string)!({
    protocolVersion: 1,
    requestId: retry.requestId,
    navigationId: retry.navigationId,
    ...(await completedResult()),
  });
  await settle();
  expect(states.at(-1)).toEqual(completed);
  lifecycle.get("pagehide")!();
  expect(ports[1]!.disconnect).toHaveBeenCalledTimes(1);
});

test("an interrupted page analysis reconnects on Retry and ignores the old reply", async () => {
  const { states, activate, requests, callbacks, ports, runtime } =
    pageHarness();
  await settle();
  activate("analyze");
  const interrupted = requests.at(-1)!;
  ports[0]!.disconnect();
  expect(states.at(-1)).toMatchObject({
    kind: "retry",
    detail: expect.stringContaining("interrupted"),
  });
  expect(runtime.connect).toHaveBeenCalledTimes(1);
  activate("analyze");
  expect(runtime.connect).toHaveBeenCalledTimes(2);
  const retry = requests.at(-1)!;
  callbacks.get(interrupted.requestId as string)!({
    protocolVersion: 1,
    requestId: interrupted.requestId,
    navigationId: interrupted.navigationId,
    type: "analysis.failed",
    code: "analysis_interrupted",
  });
  await settle();
  expect(states.at(-1)).toEqual({ kind: "running", phase: "resolving" });
  callbacks.get(retry.requestId as string)!({
    protocolVersion: 1,
    requestId: retry.requestId,
    navigationId: retry.navigationId,
    ...(await completedResult()),
  });
  await settle();
  expect(states.at(-1)).toMatchObject({ kind: "complete", total: 0 });
});
