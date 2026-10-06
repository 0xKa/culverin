import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { runLivePublic } from "./live-public";
export async function runPageCounting(
  state: Awaited<ReturnType<typeof runLivePublic>>,
) {
  const {
    context,
    clearPublicCache,
    publicSha,
    page,
    openPopup,
    summary,
    settingsPage,
    worker,
    fixtures,
    uncheckedStatus,
  } = state;

  await clearPublicCache();

  const zeroWorker =
    context.serviceWorkers()[0] ??
    (await context.waitForEvent("serviceworker"));

  await zeroWorker.evaluate(
    ({ bytes, sha }) => {
      const original = globalThis.fetch;
      globalThis.fetch = (async (input, init) => {
        if (String(input).endsWith(`/tarball/${sha}`)) {
          const response = new Response(Uint8Array.from(bytes), {
            status: 200,
            headers: { "content-type": "application/gzip" },
          });
          Object.defineProperty(response, "url", {
            value: `https://codeload.github.com/culverin/bootstrap-fixture/legacy.tar.gz/${sha}`,
          });
          return response;
        }
        return original(input, init);
      }) as typeof fetch;
    },
    {
      bytes: [...readFileSync("tests/fixtures/archive-zero.tar.gz")],
      sha: publicSha,
    },
  );

  await page.evaluate(() =>
    history.pushState({}, "", "/culverin/bootstrap-other"),
  );

  await page.getByText("Count lines of code").waitFor();

  const zeroPopup = await openPopup(page);

  await zeroPopup.getByRole("button", { name: "Analyze repository" }).click();

  await zeroPopup.getByText("0 code lines", { exact: true }).waitFor();

  const zeroDetails = await zeroPopup.locator("#detail-content").textContent();

  assert.ok(
    zeroDetails?.includes("No language totals.") ||
      zeroDetails?.includes("0.0% of code lines"),
  );

  assert.equal(await zeroPopup.getByText(/NaN|Infinity/).count(), 0);

  await page.getByText("0 lines of code", { exact: true }).waitFor();

  await zeroPopup.close();

  await page.evaluate(() =>
    history.pushState({}, "", "/culverin/bootstrap-fixture"),
  );

  await clearPublicCache();

  await page.reload();

  const countButton = page.getByRole("button", {
    name: "Count lines of code",
  });

  const rowTitle = () =>
    summary.evaluate((host) =>
      host.shadowRoot?.querySelector(".row")?.getAttribute("title"),
    );

  await countButton.waitFor();

  await summary.evaluate((host) =>
    (host.shadowRoot?.querySelector("button") as HTMLButtonElement).click(),
  );

  await page.waitForTimeout(500);

  assert.equal(await countButton.count(), 1);

  await summary.evaluate((host) => {
    const labels: string[] = [];
    const live = host.shadowRoot!.querySelector("[aria-live]")!;
    new MutationObserver(() => labels.push(live.textContent ?? "")).observe(
      live,
      { childList: true, subtree: true, characterData: true },
    );
    (window as typeof window & { culverinLabels?: string[] }).culverinLabels =
      labels;
  });

  await countButton.click();

  await page
    .getByText("0 lines of code", { exact: true })
    .waitFor({ timeout: 15_000 });

  assert.equal(await rowTitle(), "0 lines of code. Open Culverin for details");

  assert.equal(
    await page.getByRole("button", { name: "0 lines of code" }).count(),
    1,
  );

  const pageLabels = await page.evaluate(
    () =>
      (window as typeof window & { culverinLabels?: string[] }).culverinLabels,
  );

  assert.equal(pageLabels?.[0], "Preparing to count lines…");

  assert.ok(
    pageLabels?.some((label) =>
      ["Downloading source…", "Unpacking source…", "Counting lines…"].includes(
        label,
      ),
    ),
    `progress labels: ${pageLabels?.join(", ")}`,
  );

  await zeroWorker.evaluate((sha) => {
    const scope = globalThis as typeof globalThis & {
      pageOriginalFetch?: typeof fetch;
      pageFetchCount?: number;
      pageRelease?: () => void;
    };
    scope.pageOriginalFetch = fetch;
    scope.pageFetchCount = 0;
    globalThis.fetch = (async (input, init) => {
      if (String(input).endsWith(`/tarball/${sha}`)) {
        scope.pageFetchCount = (scope.pageFetchCount ?? 0) + 1;
        await new Promise<void>((resolve, reject) => {
          scope.pageRelease = resolve;
          init?.signal?.addEventListener(
            "abort",
            () => reject(new DOMException("Aborted", "AbortError")),
            { once: true },
          );
        });
        return new Response(null, { status: 404 });
      }
      return scope.pageOriginalFetch!(input, init);
    }) as typeof fetch;
  }, publicSha);

  const pageFetches = (count: number) =>
    zeroWorker.evaluate(async (count) => {
      const scope = globalThis as typeof globalThis & {
        pageFetchCount?: number;
      };
      for (let attempt = 0; attempt < 250; attempt++) {
        if ((scope.pageFetchCount ?? 0) >= count) return scope.pageFetchCount;
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      return scope.pageFetchCount;
    }, count);

  await clearPublicCache();

  await page.reload();

  await countButton.click();

  assert.equal(await pageFetches(1), 1);

  const running = page.getByRole("button", {
    name: "Preparing to count lines…",
  });

  await running.waitFor();

  const rowSpinner = summary.locator(".culverin-spinner");

  await rowSpinner.waitFor();

  assert.equal(await rowSpinner.getAttribute("aria-hidden"), "true");

  await page.emulateMedia({ reducedMotion: "reduce" });

  assert.equal(
    await rowSpinner.evaluate(
      (element) => getComputedStyle(element).animationName,
    ),
    "none",
  );

  await page.emulateMedia({ reducedMotion: "no-preference" });

  assert.equal(await rowTitle(), "Click to cancel");

  await running.click();

  await countButton.waitFor();

  assert.equal(await rowSpinner.count(), 0);

  const canceledPageJobs = await settingsPage.evaluate(async () => {
    for (let attempt = 0; attempt < 100; attempt++) {
      const state = await chrome.storage.session.get("github.job");
      if (state["github.job"] === undefined) return undefined;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    return (await chrome.storage.session.get("github.job"))["github.job"];
  });

  assert.equal(canceledPageJobs, undefined);

  await page.waitForTimeout(500);

  assert.equal(await countButton.count(), 1);

  await countButton.click();

  assert.equal(await pageFetches(2), 2);

  await rowSpinner.waitFor();

  await zeroWorker.evaluate(() =>
    (
      globalThis as typeof globalThis & { pageRelease?: () => void }
    ).pageRelease?.(),
  );

  const retryButton = page.getByRole("button", {
    name: "Couldn't count lines · Retry",
  });

  await retryButton.waitFor({ timeout: 15_000 });

  assert.equal(await rowSpinner.count(), 0);

  assert.ok((await rowTitle())?.length);

  await retryButton.click();

  assert.equal(await pageFetches(3), 3);

  await rowSpinner.waitFor();

  await page.getByRole("button", { name: "Preparing to count lines…" }).click();

  await countButton.waitFor();

  assert.equal(await rowSpinner.count(), 0);

  await zeroWorker.evaluate(() => {
    const scope = globalThis as typeof globalThis & {
      pageOriginalFetch?: typeof fetch;
      pageFetchCount?: number;
      pageRelease?: () => void;
    };
    if (scope.pageOriginalFetch) globalThis.fetch = scope.pageOriginalFetch;
    delete scope.pageOriginalFetch;
    delete scope.pageFetchCount;
    delete scope.pageRelease;
  });

  await page.setViewportSize({ width: 600, height: 720 });

  await page.reload();

  await page.waitForTimeout(1000);

  assert.equal(await summary.count(), 0);

  await page.setViewportSize({ width: 1280, height: 720 });

  await countButton.waitFor();

  assert.equal(await summary.count(), 1);

  const countingSettings = await context.newPage();

  await countingSettings.goto(
    `chrome-extension://${new URL(worker.url()).host}/settings.html#counting`,
  );

  const manualTrigger = countingSettings.getByRole("radio", {
    name: "When I click Count lines or Analyze",
  });

  const openTrigger = countingSettings.getByRole("radio", {
    name: "When I open the repository page",
  });

  await countingSettings
    .locator('input[name="count-trigger"][value="manual"]:checked')
    .waitFor();

  assert.match(
    ((await countingSettings.locator("#api-usage").textContent()) ?? "").trim(),
    /^GitHub API usage\d+\/60resets at /,
  );

  assert.match(
    (await countingSettings.locator("#api-usage-shared").textContent()) ?? "",
    /^Everything on your network that uses GitHub without signing in shares the same 60\./,
  );

  let rateLimitChecks = 0;
  let refreshed!: () => void;
  const refreshChecked = new Promise<void>((resolve) => {
    refreshed = resolve;
  });

  await context.route("https://api.github.com/rate_limit", (route) => {
    rateLimitChecks++;
    if (rateLimitChecks === 2) refreshed();
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        resources: {
          core: {
            limit: 60,
            remaining: 41,
            reset: Math.floor(Date.now() / 1000) + 3600,
            used: 19,
          },
        },
      }),
    });
  });

  await worker.evaluate(() =>
    chrome.storage.session.remove("github.rateLimit"),
  );

  const usage = countingSettings.locator("#api-usage");

  await usage.getByText("Not known yet.").waitFor();

  await usage.getByRole("button", { name: "Check now" }).click();

  await countingSettings.locator("#api-usage", { hasText: "41/60" }).waitFor();

  assert.equal(rateLimitChecks, 1);

  await usage.getByRole("button", { name: "Refresh" }).click();

  await refreshChecked;

  await countingSettings
    .locator("#api-usage-check:not([disabled])", { hasText: "Refresh" })
    .waitFor();

  assert.equal(rateLimitChecks, 2);

  assert.equal(
    await countingSettings.locator("#api-usage-status").textContent(),
    "",
  );

  await context.unroute("https://api.github.com/rate_limit");

  await countingSettings.getByText("Why does a check use 2 requests?").click();

  await countingSettings
    .getByText(/^The first asks for the repository's details/)
    .waitFor();

  await openTrigger.check();

  await countingSettings.getByText(/^Saved\./).waitFor();

  await clearPublicCache();

  await page.reload();

  await page.getByText("0 lines of code", { exact: true }).waitFor();

  await countingSettings.getByRole("link", { name: "Storage" }).click();

  await countingSettings
    .locator("#cache-summary", { hasText: "1 result for 1 repository" })
    .waitFor();

  assert.equal(
    await countingSettings
      .getByRole("link", { name: "culverin/bootstrap-fixture" })
      .getAttribute("href"),
    "https://github.com/culverin/bootstrap-fixture",
  );

  await countingSettings.getByRole("link", { name: "Counting" }).click();

  const beforeRestartedLookup = fixtures.apiRequests;

  const lookupRestart = await context.newCDPSession(page);

  await lookupRestart.send("ServiceWorker.enable");

  await lookupRestart.send("ServiceWorker.stopAllWorkers");

  await lookupRestart.detach();

  await page.waitForTimeout(500);

  assert.equal(
    await page.getByText("0 lines of code", { exact: true }).count(),
    1,
  );

  assert.equal(fixtures.apiRequests, beforeRestartedLookup);

  await page.reload();

  await page.getByText("0 lines of code", { exact: true }).waitFor();

  assert.equal(fixtures.apiRequests, beforeRestartedLookup);

  await countingSettings.reload();

  await countingSettings
    .locator('input[name="count-trigger"][value="open"]:checked')
    .waitFor();

  await manualTrigger.check();

  await countingSettings.getByText(/^Saved\./).waitFor();

  await countingSettings.getByRole("link", { name: "About" }).click();

  const aboutDetails = countingSettings.locator("#about-details");

  await aboutDetails.waitFor({ state: "visible" });

  assert.match(
    (await aboutDetails.textContent()) ?? "",
    /Version\d+\.\d+\.\d+/,
  );

  assert.match((await aboutDetails.textContent()) ?? "", /Tokei 15\.0\.0/);

  assert.equal(
    await countingSettings
      .getByRole("link", { name: "Source code" })
      .getAttribute("href"),
    "https://github.com/0xKa/culverin",
  );

  assert.equal(
    await countingSettings
      .getByRole("link", { name: "Third-party notices" })
      .getAttribute("href"),
    "THIRD_PARTY_NOTICES.txt",
  );

  await countingSettings.getByRole("link", { name: "Culverin ignore" }).click();

  await countingSettings.locator("#rules").waitFor({ state: "visible" });

  await countingSettings.close();

  const retainedCache = await settingsPage.evaluate(() =>
    chrome.storage.local.get("culverin.public-results.v1"),
  );

  await clearPublicCache();

  const beforeManualPage = fixtures.apiRequests;

  await page.reload();

  await countButton.waitFor();

  assert.equal(fixtures.apiRequests, beforeManualPage);

  await settingsPage.evaluate(
    (cache) => chrome.storage.local.set(cache),
    retainedCache,
  );

  const analysisRestart = await context.newCDPSession(page);

  await analysisRestart.send("ServiceWorker.enable");

  await analysisRestart.send("ServiceWorker.stopAllWorkers");

  await analysisRestart.detach();

  await page.waitForTimeout(500);

  await countButton.click();

  await page.getByText("0 lines of code", { exact: true }).waitFor();

  fixtures.mode = "rate";

  await clearPublicCache();

  const beforeLimitedPage = fixtures.apiRequests;

  await page.reload();

  await countButton.waitFor();

  assert.equal(fixtures.apiRequests, beforeLimitedPage);

  const limitedPopup = await openPopup(page);

  await limitedPopup.getByText(uncheckedStatus).waitFor();

  await limitedPopup
    .getByRole("button", { name: "Analyze repository" })
    .click();

  await limitedPopup
    .getByText(/GitHub rate limit reached. Retry after/)
    .waitFor();

  const limitedRequests = fixtures.apiRequests;

  await limitedPopup.close();

  await page.reload();

  await page.getByText("GitHub rate limit, try later").waitFor();

  assert.match(
    (await summary.evaluate((host) =>
      host.shadowRoot?.querySelector(".row")?.getAttribute("title"),
    )) ?? "",
    /^GitHub rate limit reached. Retry after /,
  );

  assert.equal(await page.getByRole("button", { name: /lines/ }).count(), 0);

  const cachedLimitPopup = await openPopup(page);

  await cachedLimitPopup
    .getByText(/GitHub rate limit reached. Retry after/)
    .waitFor();

  assert.equal(fixtures.apiRequests, limitedRequests);

  await cachedLimitPopup.close();
  return { ...state, countButton };
}
