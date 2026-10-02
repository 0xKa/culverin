import { afterEach, expect, jest, test } from "bun:test";
import type { BrowserContext, Page } from "playwright";
import { createPopupControls } from "../browser/support/action-popup";
import { event, settle } from "./support/events";

afterEach(() => jest.useRealTimers());

async function popup(respond: boolean) {
  const replies =
    event<(value: { sessionId: string; message: string }) => void>();
  const session = {
    on: (_name: string, listener: Parameters<typeof replies.addListener>[0]) =>
      replies.addListener(listener),
    off: (
      _name: string,
      listener: Parameters<typeof replies.removeListener>[0],
    ) => replies.removeListener(listener),
    detach: jest.fn(async () => undefined),
    send: async (method: string, data?: { message: string }) => {
      if (method === "Target.getTargets")
        return {
          targetInfos: [
            {
              targetId: "popup",
              type: "page",
              url: "chrome-extension://test/popup.html",
            },
          ],
        };
      if (method === "Target.attachToTarget") return { sessionId: "session" };
      if (method === "Target.sendMessageToTarget" && respond) {
        const command = JSON.parse(data!.message) as { id: number };
        queueMicrotask(() =>
          replies.emit({
            sessionId: "session",
            message: JSON.stringify({
              id: command.id,
              result: { result: { value: "Cached local analysis" } },
            }),
          }),
        );
      }
      return {};
    },
  };
  const context = {
    newCDPSession: async () => session,
  } as unknown as BrowserContext;
  const controls = createPopupControls(
    context,
    {} as Page,
    "chrome-extension://test/background.js",
  );
  return { ui: await controls.actionPopup(), replies, session };
}

test("lost popup protocol replies fail promptly and remove their listener and timer", async () => {
  jest.useFakeTimers();
  const { ui, replies } = await popup(false);
  const status = ui.status(/^Cached/);
  const failure = status.catch((error: unknown) => error);
  await settle();
  expect(replies.listeners.size).toBe(1);
  jest.advanceTimersByTime(5000);
  expect(await failure).toEqual(new Error("Action popup evaluation timed out"));
  expect(replies.listeners.size).toBe(0);
  expect(jest.getTimerCount()).toBe(0);
});

test("successful popup protocol replies clear resources before closing", async () => {
  jest.useFakeTimers();
  const { ui, replies, session } = await popup(true);
  expect(await ui.status(/^Cached/)).toBe("Cached local analysis");
  expect(replies.listeners.size).toBe(0);
  expect(jest.getTimerCount()).toBe(0);
  await ui.close();
  expect(session.detach).toHaveBeenCalledTimes(1);
});
