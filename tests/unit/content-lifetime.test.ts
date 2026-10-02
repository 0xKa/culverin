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

test("page analysis allows sparse progress beyond one minute and ends on engine or transport failure", async () => {
  jest.useFakeTimers();
  const states: RowState[] = [];
  let activate!: (action: RowAction) => void;
  const requests: Record<string, unknown>[] = [];
  const callbacks = new Map<string, (value: unknown) => void>();
  const messages = event<(message: unknown, sender: unknown) => void>();
  const disconnect = event<() => void>();
  const runtime = {
    id: "test",
    getURL: (path: string) => `chrome-extension://test/${path}`,
    connect: () => ({ disconnect: () => undefined, onDisconnect: disconnect }),
    onMessage: messages,
    sendMessage: (
      request: Record<string, unknown>,
      callback: (value: unknown) => void,
    ) => {
      requests.push(request);
      callbacks.set(request.requestId as string, callback);
      if (request.type === "repository.lookup")
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
    addEventListener: () => undefined,
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
  disconnect.emit();
  expect(states.at(-1)).toMatchObject({
    kind: "retry",
    detail: expect.stringContaining("interrupted"),
  });
});
