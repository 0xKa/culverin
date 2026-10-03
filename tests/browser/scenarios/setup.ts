import assert from "node:assert/strict";
import { createPopupControls } from "../support/action-popup";
import { installGitHubFixtures } from "../support/fixtures";
import type { createBrowserSession } from "../support/session";
export async function runSetup(
  state: Awaited<ReturnType<typeof createBrowserSession>>,
) {
  const { context } = state;

  const page = await context.newPage();

  const publicSha = "a".repeat(40);

  const fixtures = await installGitHubFixtures(context, page, publicSha);
  const summary = page.locator("[data-culverin-root]");
  await page.goto("https://github.com/culverin/bootstrap-fixture#readme");

  await page.getByText("Count lines of code").waitFor();

  assert.equal(await summary.count(), 1);

  assert.deepEqual(
    await summary.evaluate((host) => ({
      after: host.previousElementSibling?.querySelector("a")?.id,
      before: host.nextElementSibling?.textContent,
      live: host.shadowRoot?.querySelector('[aria-live="polite"]')?.textContent,
      icon: host.shadowRoot?.querySelector("svg")?.getAttribute("fill"),
      shapes: host.shadowRoot?.querySelectorAll("svg rect").length,
    })),
    {
      after: "forks",
      before: "Report repository",
      live: "Count lines of code",
      icon: "currentColor",
      shapes: 6,
    },
  );

  assert.equal(
    await page.getByRole("button", { name: "Analyze repository" }).count(),
    0,
  );

  assert.equal(fixtures.archiveRequests, 0);

  const worker =
    context.serviceWorkers()[0] ??
    (await context.waitForEvent("serviceworker"));

  const harness = await context.newPage();

  await harness.goto(
    `chrome-extension://${new URL(worker.url()).host}/test-harness.html`,
  );

  const beforeWorkerStopApiRequests = fixtures.apiRequests;

  const workerControl = await context.newCDPSession(page);

  await workerControl.send("ServiceWorker.enable");

  await workerControl.send("ServiceWorker.stopAllWorkers");

  await workerControl.detach();

  await page.waitForTimeout(1500);

  assert.equal(fixtures.apiRequests, beforeWorkerStopApiRequests);

  assert.equal(await page.getByText("Count lines of code").count(), 1);

  const { openActionPopup, actionPopup, openPopup, extensionUrl } =
    createPopupControls(context, harness, worker.url());
  return {
    ...state,
    fixtures,
    openActionPopup,
    page,
    actionPopup,
    openPopup,
    extensionUrl,
    publicSha,
    summary,
    harness,
    worker,
  };
}
