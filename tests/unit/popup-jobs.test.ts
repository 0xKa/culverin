import { expect, jest, test } from "bun:test";
import { createPopupJobs } from "../../extension/src/background/popup-jobs";
import type { BackgroundResources } from "../../extension/src/background/resources";
import type { createPublicAnalysis } from "../../extension/src/background/analysis";
import { event, settle } from "./support/events";

async function lookup(
  focusedId?: number,
  windowActiveId = 1,
  senderTab?: chrome.tabs.Tab,
) {
  const query = jest.fn(async (options: chrome.tabs.QueryInfo) =>
    options.windowId !== undefined
      ? [{ id: windowActiveId }]
      : focusedId === undefined
        ? []
        : [{ id: focusedId }],
  );
  const resources = {
    chrome: {
      tabs: {
        query,
        get: async () => ({
          id: 1,
          windowId: 7,
          url: "https://github.com/culverin/sample",
        }),
      },
    },
    pending: new Map(),
  } as unknown as BackgroundResources;
  const run = jest.fn();
  const jobs = createPopupJobs(resources, { run } as ReturnType<
    typeof createPublicAnalysis
  >);
  const onMessage = event<(message: unknown) => void>();
  const postMessage = jest.fn();
  jobs.attach({
    sender: { id: "test", tab: senderTab },
    onMessage,
    onDisconnect: event(),
    postMessage,
  } as unknown as chrome.runtime.Port);
  onMessage.emit({
    protocolVersion: 1,
    type: "repository.lookup",
    requestId: crypto.randomUUID(),
    navigationId: crypto.randomUUID(),
    tabId: 1,
    repository: { owner: "culverin", name: "sample" },
  });
  await settle();
  return { query, run, postMessage };
}

test("a toolbar popup with no last-focused active tab validates its repository window", async () => {
  const ui = await lookup();
  expect(ui.query).toHaveBeenCalledWith({ active: true, windowId: 7 });
  expect(ui.run).toHaveBeenCalledTimes(1);
  expect(ui.postMessage).not.toHaveBeenCalled();
});

test("toolbar fallback rejects another active tab in the requested window", async () => {
  const ui = await lookup(undefined, 2);
  expect(ui.run).not.toHaveBeenCalled();
  expect(ui.postMessage).toHaveBeenCalledWith(
    expect.objectContaining({
      type: "analysis.failed",
      code: "invalid_repository",
    }),
  );
});

test("another focused tab and popup documents in tabs retain the original gate", async () => {
  for (const ui of [
    await lookup(2),
    await lookup(undefined, 1, { id: 3 } as chrome.tabs.Tab),
  ]) {
    expect(ui.query).toHaveBeenCalledTimes(1);
    expect(ui.run).not.toHaveBeenCalled();
    expect(ui.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "analysis.failed",
        code: "invalid_repository",
      }),
    );
  }
});
