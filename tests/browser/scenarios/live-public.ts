import assert from "node:assert/strict";
import type { runAcquisitionLifetimes } from "./acquisition-lifetimes";
export async function runLivePublic(
  state: Awaited<ReturnType<typeof runAcquisitionLifetimes>>,
) {
  const { context, openPopup, settingsPage } = state;

  if (process.env.CULVERIN_LIVE_PUBLIC === "1") {
    const networkOrigins = new Set<string>();
    const requests: {
      origin: string;
      authorization: boolean;
      cookie: boolean;
    }[] = [];
    context.on("request", (request) => {
      if (!request.serviceWorker()) return;
      const origin = new URL(request.url()).origin;
      if (origin.startsWith("https://")) networkOrigins.add(origin);
      if (
        origin === "https://api.github.com" ||
        origin === "https://codeload.github.com"
      ) {
        const headers = request.headers();
        requests.push({
          origin,
          authorization: Boolean(headers.authorization),
          cookie: Boolean(headers.cookie),
        });
      }
    });
    const livePage = await context.newPage();
    await livePage.goto("https://github.com/octocat/Hello-World", {
      waitUntil: "commit",
      timeout: 60_000,
    });
    let livePopup = await openPopup(livePage);
    await livePopup
      .getByRole("button", { name: "Analyze repository" })
      .waitFor({ timeout: 30_000 });
    await livePopup.getByText(/Ready to analyze/).waitFor({ timeout: 30_000 });
    const beforeClick = requests.filter(
      (request) => request.origin === "https://codeload.github.com",
    ).length;
    await livePopup.close();
    await livePage.reload({ waitUntil: "commit", timeout: 60_000 });
    livePopup = await openPopup(livePage);
    await livePopup.getByText(/Ready to analyze/).waitFor({ timeout: 30_000 });
    assert.equal(
      requests.filter(
        (request) => request.origin === "https://codeload.github.com",
      ).length,
      beforeClick,
    );
    await livePopup.getByRole("button", { name: "Analyze repository" }).click();
    await livePopup
      .getByText(/Analyzed locally.|Partial local analysis./)
      .waitFor({ timeout: 30_000 });
    assert.equal(
      requests.filter(
        (request) => request.origin === "https://codeload.github.com",
      ).length,
      beforeClick + 1,
    );
    await livePopup.close();
    await livePage.close();
    const beforeSettingsLookup = requests.filter(
      (request) => request.origin === "https://codeload.github.com",
    ).length;
    const sendLive = (type: string) =>
      settingsPage.evaluate(
        (type) =>
          new Promise<{
            state?: string;
            resolution?: { visibility: string };
          }>((resolve) =>
            chrome.runtime.sendMessage(
              {
                protocolVersion: 1,
                type,
                requestId: crypto.randomUUID(),
                navigationId: crypto.randomUUID(),
                owner: "octocat",
                name: "Hello-World",
              },
              resolve,
            ),
          ),
        type,
      );
    const lookup = await sendLive("repository.lookup");
    assert.equal(lookup.state, "resolved");
    assert.equal(lookup.resolution?.visibility, "public");
    assert.equal(
      requests.filter(
        (request) => request.origin === "https://codeload.github.com",
      ).length,
      beforeSettingsLookup,
    );
    assert.equal((await sendLive("analysis.request")).state, "analyzed");
    assert.equal(
      requests.filter(
        (request) => request.origin === "https://codeload.github.com",
      ).length,
      beforeSettingsLookup + 1,
    );
    assert.ok(
      requests.some((request) => request.origin === "https://api.github.com"),
    );
    assert.ok(
      requests.some(
        (request) => request.origin === "https://codeload.github.com",
      ),
    );
    assert.ok(
      requests.every((request) => !request.authorization && !request.cookie),
    );
    assert.ok(
      [...networkOrigins].every((origin) =>
        [
          "https://api.github.com",
          "https://codeload.github.com",
          "https://github.com",
        ].includes(origin),
      ),
    );
    console.log(`Live public acquisition passed: ${JSON.stringify(requests)}`);
  }
  return { ...state };
}
