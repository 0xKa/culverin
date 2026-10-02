import assert from "node:assert/strict";
import type { BrowserContext, Page } from "playwright";
export function createPopupControls(
  context: BrowserContext,
  harness: Page,
  workerUrl: string,
) {
  const openActionPopup = async (tab: Page) => {
    await tab.bringToFront();
    const opened = await harness.evaluate(
      () =>
        new Promise<{ ok: boolean }>((resolve) =>
          chrome.tabs.query(
            { active: true, lastFocusedWindow: true },
            (tabs) => {
              const tabId = tabs[0]?.id;
              if (tabId === undefined) {
                resolve({ ok: false });
                return;
              }
              chrome.runtime.sendMessage(
                { type: "popup.open", targetTabId: tabId },
                resolve,
              );
            },
          ),
        ),
    );
    assert.equal(opened.ok, true);
  };

  const extensionUrl = `chrome-extension://${new URL(workerUrl).host}`;

  const actionPopup = async () => {
    const session = await context.newCDPSession(harness);
    let targetId: string | undefined;
    for (let attempt = 0; attempt < 100 && !targetId; attempt++) {
      const { targetInfos } = await session.send("Target.getTargets");
      const candidates = targetInfos.filter(
        (item) =>
          item.type === "page" && item.url === `${extensionUrl}/popup.html`,
      );
      assert.ok(candidates.length <= 1);
      targetId = candidates[0]?.targetId;
      if (!targetId) await harness.waitForTimeout(50);
    }
    assert.ok(targetId, "action popup opened");
    const { sessionId } = await session.send("Target.attachToTarget", {
      targetId,
      flatten: false,
    });
    let nextId = 0;
    const evaluate = async <T>(expression: string): Promise<T> => {
      const id = ++nextId;
      const result = new Promise<T>((resolve, reject) => {
        const listener = (event: { sessionId: string; message: string }) => {
          const message = JSON.parse(event.message) as {
            id?: number;
            error?: unknown;
            result?: {
              result?: { value?: unknown };
              exceptionDetails?: unknown;
            };
          };
          if (event.sessionId !== sessionId || message.id !== id) return;
          session.off("Target.receivedMessageFromTarget", listener);
          if (message.error || message.result?.exceptionDetails)
            reject(new Error(event.message));
          else resolve(message.result?.result?.value as T);
        };
        session.on("Target.receivedMessageFromTarget", listener);
      });
      await session.send("Target.sendMessageToTarget", {
        sessionId,
        message: JSON.stringify({
          id,
          method: "Runtime.evaluate",
          params: { expression, returnByValue: true },
        }),
      });
      return result;
    };
    const statusText = () =>
      evaluate<string>("document.querySelector('#status')?.textContent ?? ''");
    return {
      status: async (pattern: RegExp) => {
        for (let attempt = 0; attempt < 300; attempt++) {
          const text = await statusText();
          if (pattern.test(text)) return text;
          await harness.waitForTimeout(50);
        }
        throw new Error(`Action popup status: ${await statusText()}`);
      },
      click: (selector: string) =>
        evaluate<void>(
          `document.querySelector(${JSON.stringify(selector)}).click()`,
        ),
      close: async () => {
        await session.send("Target.closeTarget", { targetId });
        await session.detach();
      },
    };
  };

  const openPopup = async (tab: Page) => {
    await tab.bringToFront();
    const popup = await context.newPage();
    await popup.goto(`${extensionUrl}/popup.html`);
    await tab.bringToFront();
    await popup.reload();
    await popup.locator("#repository").waitFor({ state: "visible" });
    return popup;
  };

  return { openActionPopup, actionPopup, openPopup, extensionUrl };
}
