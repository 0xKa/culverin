import assert from "node:assert/strict";
import type { runSetup } from "./setup";
export async function runPagePopupLifetimes(
  state: Awaited<ReturnType<typeof runSetup>>,
) {
  const {
    context,
    fixtures,
    openActionPopup,
    page,
    actionPopup,
    openPopup,
    extensionUrl,
    publicSha,
    summary,
    harness,
  } = state;

  const uncheckedStatus =
    "Analyze checks GitHub and counts the source locally.";

  const beforePopupApiRequests = fixtures.apiRequests;

  await openActionPopup(page);

  const firstActionPopup = await actionPopup();

  await firstActionPopup.status(/^Analyze checks GitHub and counts/);

  await firstActionPopup.close();

  const popup = await openPopup(page);

  await popup.getByText(uncheckedStatus).waitFor({ timeout: 15_000 });

  assert.equal(await popup.locator("#sizes").isHidden(), true);

  assert.equal(fixtures.apiRequests, beforePopupApiRequests);

  await popup.getByRole("button", { name: "Analyze repository" }).focus();

  assert.equal(
    await popup
      .getByRole("button", { name: "Analyze repository" })
      .evaluate((button) => getComputedStyle(button).outlineStyle),
    "solid",
  );

  await popup.emulateMedia({ colorScheme: "light" });

  const lightPalette = await popup.locator("html").evaluate((element) => {
    const style = getComputedStyle(element);
    return [style.backgroundColor, style.color];
  });

  await popup.emulateMedia({ colorScheme: "dark" });

  const darkPalette = await popup.locator("html").evaluate((element) => {
    const style = getComputedStyle(element);
    return [style.backgroundColor, style.color];
  });

  assert.notDeepEqual(lightPalette, darkPalette);

  await popup.emulateMedia({ forcedColors: "active" });

  assert.equal(
    await popup
      .getByRole("button", { name: "Analyze repository" })
      .evaluate((button) => getComputedStyle(button).outlineStyle),
    "solid",
  );

  await popup.emulateMedia({ colorScheme: "light", forcedColors: "none" });

  assert.equal(fixtures.archiveRequests, 0);

  await popup.close();

  const interruptedLookupPopup = await context.newPage();

  await interruptedLookupPopup.addInitScript(() => {
    const connect = chrome.runtime.connect.bind(chrome.runtime);
    chrome.runtime.connect = ((info: chrome.runtime.ConnectInfo) => {
      const port = connect(info);
      const postMessage = port.postMessage.bind(port);
      port.postMessage = (message: { type?: string }) => {
        if (message.type === "repository.lookup")
          throw new Error("Extension unavailable");
        postMessage(message);
      };
      return port;
    }) as typeof chrome.runtime.connect;
  });

  await interruptedLookupPopup.goto(`${extensionUrl}/popup.html`);

  await page.bringToFront();

  await interruptedLookupPopup.reload();

  await interruptedLookupPopup
    .getByText("Extension unavailable. Reopen the popup to retry.")
    .waitFor();

  assert.equal(
    await interruptedLookupPopup
      .getByRole("button", { name: "Analyze repository" })
      .isEnabled(),
    true,
  );

  await interruptedLookupPopup.close();

  assert.equal(fixtures.archiveRequests, 0);

  const beforeFragmentApiRequests = fixtures.apiRequests;

  await page.evaluate(() => {
    location.hash = "usage";
  });

  await page.waitForTimeout(150);

  assert.equal(await page.locator("[data-culverin-root]").count(), 1);

  assert.equal(fixtures.apiRequests, beforeFragmentApiRequests);

  assert.equal(fixtures.archiveRequests, 0);

  const failedPopup = await openPopup(page);

  await failedPopup.getByRole("button", { name: "Analyze repository" }).click();

  await failedPopup
    .getByText(/Repository unavailable or access is restricted/)
    .waitFor({ timeout: 15_000 });

  assert.equal(fixtures.archiveRequests, 1);

  await failedPopup.close();

  const beforeKnownPopupApiRequests = fixtures.apiRequests;

  const knownPopup = await openPopup(page);

  await knownPopup
    .getByText(/Ready to analyze main at/)
    .waitFor({ timeout: 15_000 });

  assert.equal(
    await knownPopup.locator("#repository-size").textContent(),
    "2 MB",
  );

  await knownPopup
    .locator("#api-limit", { hasText: "API 57/60" })
    .waitFor({ timeout: 5000 });

  assert.equal(
    await knownPopup.locator("#api-limit-meter").getAttribute("data-level"),
    "low",
  );

  assert.match(
    (await knownPopup.locator("#api-limit-reset").textContent()) ?? "",
    /^Resets at \d/,
  );

  assert.equal(
    await knownPopup.locator("#snapshot-label").textContent(),
    `Files at ${publicSha.slice(0, 12)}`,
  );

  assert.equal(
    await knownPopup.locator("#snapshot-size").textContent(),
    "Available after analysis",
  );

  assert.equal(fixtures.apiRequests, beforeKnownPopupApiRequests);

  await knownPopup.close();

  await page.reload();

  await page.getByText("Count lines of code").waitFor();

  assert.equal(fixtures.archiveRequests, 1);

  await page.evaluate(() => {
    history.pushState({}, "", "/culverin/bootstrap-fixture/issues");
  });

  await page.locator("[data-culverin-root]").waitFor({ state: "detached" });

  await page.evaluate(() => {
    history.replaceState({}, "", "/culverin/bootstrap-fixture");
  });

  await page.getByText("Count lines of code").waitFor();

  assert.equal(await page.locator("[data-culverin-root]").count(), 1);

  assert.equal(fixtures.archiveRequests, 1);

  const originalRoot = await page
    .locator("[data-culverin-root]")
    .elementHandle();

  await page.evaluate(() => {
    history.pushState({}, "", "/culverin/bootstrap-other");
  });

  await page.waitForFunction((root) => !root.isConnected, originalRoot);

  await page.getByText("Count lines of code").waitFor();

  assert.equal(await page.locator("[data-culverin-root]").count(), 1);

  assert.equal(fixtures.archiveRequests, 1);

  const otherRoot = await page.locator("[data-culverin-root]").elementHandle();

  await page.evaluate(() => {
    history.back();
  });

  await page.waitForFunction((root) => !root.isConnected, otherRoot);

  await page.getByText("Count lines of code").waitFor();

  assert.equal(await page.locator("[data-culverin-root]").count(), 1);

  await page.evaluate(() => history.forward());

  await page.getByText("Count lines of code").waitFor();

  assert.equal(await page.locator("[data-culverin-root]").count(), 1);

  await page.evaluate(() => history.back());

  await page.getByText("Count lines of code").waitFor();

  assert.equal(await page.locator("[data-culverin-root]").count(), 1);

  const beforeReplacementApiRequests = fixtures.apiRequests;

  await page.evaluate(() => {
    const about = document.querySelector("#about");
    if (!about) throw new Error("Missing About section");
    const replacement = about.cloneNode(true) as Element;
    replacement.querySelector("[data-culverin-root]")?.remove();
    about.replaceWith(replacement);
  });

  await page.waitForFunction(() =>
    document
      .querySelector("#about #forks")
      ?.parentElement?.nextElementSibling?.hasAttribute("data-culverin-root"),
  );

  await page.getByText("Count lines of code").waitFor();

  assert.equal(await summary.count(), 1);

  assert.equal(fixtures.apiRequests, beforeReplacementApiRequests);

  await page.evaluate(() => sessionStorage.setItem("holdHydration", "1"));

  await page.reload();

  await page.waitForTimeout(800);

  assert.equal(await summary.count(), 0);

  await page.evaluate(() => {
    sessionStorage.removeItem("holdHydration");
    document.querySelector("#app")?.classList.add("loaded");
  });

  await summary.waitFor({ state: "attached" });

  assert.equal(await summary.getAttribute("hidden"), null);

  assert.equal(
    await summary.evaluate(
      (host) => host.previousElementSibling?.querySelector("a")?.id,
    ),
    "forks",
  );

  await page.getByText("Count lines of code").waitFor({ timeout: 1000 });

  await page.evaluate(() => sessionStorage.setItem("holdHydration", "1"));

  await page.reload();

  await page.waitForTimeout(800);

  assert.equal(await summary.count(), 0);

  await page.getByText("Count lines of code").waitFor({ timeout: 4000 });

  assert.equal(
    await page.evaluate(() => {
      sessionStorage.removeItem("holdHydration");
      return document.querySelector("#app")?.classList.contains("loaded");
    }),
    false,
  );

  await page.reload();

  await page.getByText("Count lines of code").waitFor();

  assert.equal(fixtures.archiveRequests, 1);

  fixtures.mode = "slow";

  const started = new Promise<void>((resolve) => {
    fixtures.slowArchiveStarted = resolve;
  });

  await page.getByText("Count lines of code").waitFor();

  const cancelPopup = await openPopup(page);

  await cancelPopup.getByRole("button", { name: "Analyze repository" }).click();

  await started;

  const analysisSpinner = cancelPopup.locator("#status .culverin-spinner");

  await analysisSpinner.waitFor();

  assert.equal(await analysisSpinner.getAttribute("aria-hidden"), "true");

  assert.equal(await cancelPopup.locator("#analyze").isDisabled(), true);

  assert.equal(
    await analysisSpinner.evaluate(
      (element) => getComputedStyle(element).animationName,
    ),
    "culverin-spin",
  );

  await cancelPopup.emulateMedia({ reducedMotion: "reduce" });

  assert.equal(
    await analysisSpinner.evaluate(
      (element) => getComputedStyle(element).animationName,
    ),
    "none",
  );

  await cancelPopup.emulateMedia({
    reducedMotion: "no-preference",
    forcedColors: "active",
  });

  assert.equal(
    await analysisSpinner.evaluate(
      (element) => getComputedStyle(element).borderRightColor,
    ),
    "rgba(0, 0, 0, 0)",
  );

  await cancelPopup.emulateMedia({ forcedColors: "none" });

  await page.evaluate(() => {
    location.hash = "readme";
  });

  await page.waitForTimeout(150);

  assert.equal(await page.locator("[data-culverin-root]").count(), 1);

  await cancelPopup.getByRole("button", { name: "Cancel analysis" }).click();

  await cancelPopup.getByText("Analysis canceled.").waitFor();

  assert.equal(await analysisSpinner.count(), 0);

  await page.waitForTimeout(1700);

  assert.equal(await page.getByText("Count lines of code").count(), 1);

  await cancelPopup.close();

  const navigationArchive = new Promise<void>((resolve) => {
    fixtures.slowArchiveStarted = resolve;
  });

  const navigatingPopup = await openPopup(page);

  await navigatingPopup
    .getByRole("button", { name: "Analyze repository" })
    .click();

  await navigationArchive;

  const popupJobs = await harness.evaluate(async () => {
    const state = await chrome.storage.session.get("github.job");
    return state["github.job"] as { owner: string }[] | undefined;
  });

  assert.equal(popupJobs?.length, 1);

  assert.ok(popupJobs?.[0]?.owner.startsWith("u:"));

  await page.evaluate(() => {
    history.pushState({}, "", "/culverin/bootstrap-fixture/issues");
  });

  await page.locator("[data-culverin-root]").waitFor({ state: "detached" });

  await navigatingPopup
    .getByText("The active tab changed. Reopen the popup to analyze it.")
    .waitFor();

  const canceledPopupJobs = await harness.evaluate(async () => {
    for (let attempt = 0; attempt < 100; attempt++) {
      const state = await chrome.storage.session.get("github.job");
      if (state["github.job"] === undefined) return undefined;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    return (await chrome.storage.session.get("github.job"))["github.job"];
  });

  assert.equal(canceledPopupJobs, undefined);

  fixtures.mode = "ok";

  if (!navigatingPopup.isClosed()) await navigatingPopup.close();

  await page.evaluate(() => {
    history.replaceState({}, "", "/culverin/bootstrap-fixture");
  });

  await page.getByText("Count lines of code").waitFor({ timeout: 1000 });

  const retryPopup = await openPopup(page);

  await retryPopup.getByRole("button", { name: "Analyze repository" }).click();

  await retryPopup
    .getByText(/Repository unavailable or access is restricted/)
    .waitFor();

  await retryPopup.close();

  assert.equal(fixtures.archiveRequests, 4);

  fixtures.mode = "slow";

  const switchedArchive = new Promise<void>((resolve) => {
    fixtures.slowArchiveStarted = resolve;
  });

  const switchingPopup = await openPopup(page);

  await switchingPopup
    .getByRole("button", { name: "Analyze repository" })
    .click();

  await switchedArchive;

  const otherTab = await context.newPage();

  await otherTab.bringToFront();

  await switchingPopup
    .getByText("The active tab changed. Reopen the popup to analyze it.")
    .waitFor();

  await page.waitForTimeout(300);

  const switchedJobs = await harness.evaluate(async () => {
    const state = await chrome.storage.session.get("github.job");
    return state["github.job"] as { requestId: string }[] | undefined;
  });

  assert.equal(switchedJobs?.length, 1);

  const repositoryTabId = await harness.evaluate(
    async () =>
      (
        await chrome.tabs.query({
          url: "https://github.com/culverin/bootstrap-fixture*",
        })
      )[0]?.id,
  );

  const switchedCancel = await switchingPopup.evaluate(
    ({ tabId, targetRequestId }) =>
      new Promise<{ type?: string }>((resolve) => {
        const port = chrome.runtime.connect({ name: "culverin.popup" });
        const requestId = crypto.randomUUID();
        port.onMessage.addListener(
          (message: { requestId?: string; type?: string }) => {
            if (message.requestId !== requestId) return;
            port.disconnect();
            resolve(message);
          },
        );
        port.postMessage({
          protocolVersion: 1,
          type: "analysis.cancel",
          requestId,
          navigationId: crypto.randomUUID(),
          targetRequestId,
          tabId,
        });
      }),
    { tabId: repositoryTabId, targetRequestId: switchedJobs?.[0]?.requestId },
  );

  assert.equal(switchedCancel.type, "analysis.canceled");

  const switchedCanceledJobs = await harness.evaluate(async () => {
    for (let attempt = 0; attempt < 100; attempt++) {
      const state = await chrome.storage.session.get("github.job");
      if (state["github.job"] === undefined) return undefined;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    return (await chrome.storage.session.get("github.job"))["github.job"];
  });

  assert.equal(switchedCanceledJobs, undefined);

  await otherTab.close();

  await switchingPopup.close();

  fixtures.mode = "ok";

  assert.equal(fixtures.archiveRequests, 5);

  const clearPublicCache = async () => {
    const worker =
      context.serviceWorkers()[0] ??
      (await context.waitForEvent("serviceworker"));
    const control = await context.newPage();
    await control.goto(
      `chrome-extension://${new URL(worker.url()).host}/settings.html`,
    );
    const state = await control.evaluate(
      () =>
        new Promise<{ state: string }>((resolve) =>
          chrome.runtime.sendMessage(
            {
              protocolVersion: 1,
              type: "cache.clear-public",
              requestId: crypto.randomUUID(),
              navigationId: crypto.randomUUID(),
            },
            resolve,
          ),
        ),
    );
    assert.equal(state.state, "public-cache-cleared");
    await control.close();
  };

  fixtures.mode = "empty";

  await clearPublicCache();

  const beforeUncachedApiRequests = fixtures.apiRequests;

  await page.reload();

  await summary.waitFor({ state: "attached" });

  await page.getByText("Count lines of code").waitFor();

  assert.equal(fixtures.apiRequests, beforeUncachedApiRequests);

  const emptyPopup = await openPopup(page);

  await emptyPopup.getByText(uncheckedStatus).waitFor();

  await emptyPopup.getByRole("button", { name: "Analyze repository" }).click();

  await emptyPopup
    .getByText("This repository has no default-branch commit to analyze.")
    .waitFor();

  await emptyPopup.close();

  fixtures.mode = "private";

  await clearPublicCache();

  await page.reload();

  await summary.waitFor({ state: "attached" });

  await page.getByText("Count lines of code").waitFor();

  const privatePopup = await openPopup(page);

  await privatePopup.getByText(uncheckedStatus).waitFor();

  await privatePopup
    .getByRole("button", { name: "Analyze repository" })
    .click();

  await privatePopup
    .getByText(/This repository is private or doesn't exist/)
    .waitFor();

  assert.equal(
    await privatePopup
      .getByRole("button", { name: "Connect GitHub" })
      .isVisible(),
    true,
  );

  await privatePopup.close();

  await page.getByText("Count lines of code").click();

  await page.getByText("Private repository? Connect GitHub").waitFor();

  const openedGitHubSettings = context.waitForEvent("page");

  await page.getByText("Private repository? Connect GitHub").click();

  const githubSettingsPage = await openedGitHubSettings;

  await githubSettingsPage.waitForLoadState();

  assert.equal(new URL(githubSettingsPage.url()).hash, "#github");

  await githubSettingsPage.locator("#github-heading").waitFor();

  await githubSettingsPage.close();

  assert.equal(fixtures.archiveRequests, 5);

  fixtures.mode = "ok";

  await page.route("https://github.com/settings/profile", (route) =>
    route.fulfill({
      status: 200,
      contentType: "text/html",
      body: "<!doctype html><html><body><main>Settings</main></body></html>",
    }),
  );

  await page.goto("https://github.com/settings/profile");

  assert.equal(await page.locator("[data-culverin-root]").count(), 0);
  return { ...state, repositoryTabId, clearPublicCache, uncheckedStatus };
}
