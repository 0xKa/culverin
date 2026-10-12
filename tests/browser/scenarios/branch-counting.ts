import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { runLivePublic } from "./live-public";

export async function runBranchCounting(
  state: Awaited<ReturnType<typeof runLivePublic>>,
) {
  const {
    context,
    clearPublicCache,
    publicSha,
    page,
    openPopup,
    settingsPage,
    extensionUrl,
    fixtures,
    summary,
  } = state;
  const branchSha = "b".repeat(40);

  await clearPublicCache();
  fixtures.mode = "ok";
  fixtures.branches = { feature: branchSha };

  const worker =
    context.serviceWorkers()[0] ??
    (await context.waitForEvent("serviceworker"));
  await worker.evaluate(
    ({ bytes, shas }) => {
      const scope = globalThis as typeof globalThis & {
        branchFetch?: typeof fetch;
        branchArchives?: string[];
      };
      scope.branchFetch = fetch;
      scope.branchArchives = [];
      globalThis.fetch = (async (input, init) => {
        const sha = shas.find((value) =>
          String(input).endsWith(`/tarball/${value}`),
        );
        if (!sha) return scope.branchFetch!(input, init);
        scope.branchArchives!.push(sha);
        const response = new Response(Uint8Array.from(bytes), {
          status: 200,
          headers: { "content-type": "application/gzip" },
        });
        Object.defineProperty(response, "url", {
          value: `https://codeload.github.com/culverin/bootstrap-fixture/legacy.tar.gz/${sha}`,
        });
        return response;
      }) as typeof fetch;
    },
    {
      bytes: [...readFileSync("tests/fixtures/archive-source.tar.gz")],
      shas: [publicSha, branchSha],
    },
  );
  const archives = () =>
    worker.evaluate(
      () =>
        (globalThis as typeof globalThis & { branchArchives?: string[] })
          .branchArchives ?? [],
    );

  await page.goto("https://github.com/culverin/bootstrap-fixture");
  await page.getByText("Analyze with Culverin").waitFor();
  const rootRow = await summary.elementHandle();

  const beforeBranchPage = fixtures.apiRequests;
  await page.evaluate(() =>
    history.pushState({}, "", "/culverin/bootstrap-fixture/tree/feature"),
  );
  await page.waitForFunction((root) => !root?.isConnected, rootRow);
  await page.getByText("Analyze with Culverin").waitFor();
  await page.waitForTimeout(300);
  assert.equal(fixtures.apiRequests, beforeBranchPage);

  await page.getByText("Analyze with Culverin").click();
  await page.getByText(/ lines? of code$/).waitFor();
  assert.deepEqual(await archives(), [branchSha]);
  assert.equal(fixtures.apiRequests, beforeBranchPage + 2);

  const branchPopup = await openPopup(page);
  const revision = branchPopup.locator("#revision");
  await revision.waitFor({ state: "visible" });
  assert.match((await revision.textContent()) ?? "", /^feature, commit b{12}$/);
  assert.equal(
    await revision.locator("[data-tip]").getAttribute("data-tip"),
    "Not the default branch (main)",
  );
  await branchPopup.close();

  await page.evaluate(() =>
    history.pushState({}, "", "/culverin/bootstrap-fixture/tree/feature/src"),
  );
  await summary.waitFor({ state: "detached" });
  const folderPopup = await openPopup(page);
  await folderPopup.locator("#revision").waitFor({ state: "visible" });
  assert.match(
    (await folderPopup.locator("#revision").textContent()) ?? "",
    /^feature, commit b{12}$/,
  );
  await folderPopup.close();
  assert.equal(fixtures.apiRequests, beforeBranchPage + 2);

  await page.evaluate(() =>
    history.replaceState({}, "", "/culverin/bootstrap-fixture"),
  );
  await page.getByText("Analyze with Culverin").waitFor();
  await page.waitForTimeout(300);
  assert.equal(await page.getByText(/ lines? of code$/).count(), 0);

  await page.getByText("Analyze with Culverin").click();
  await page.getByText(/ lines? of code$/).waitFor();
  assert.deepEqual(await archives(), [branchSha, publicSha]);
  const defaultPopup = await openPopup(page);
  await defaultPopup.locator("#revision").waitFor({ state: "visible" });
  assert.match(
    (await defaultPopup.locator("#revision").textContent()) ?? "",
    /^main, commit [0-9a-f]{12}$/,
  );
  assert.equal(await defaultPopup.locator("#revision [data-tip]").count(), 0);
  await defaultPopup.close();

  await page.evaluate(() =>
    history.pushState({}, "", "/culverin/bootstrap-fixture/tree/main"),
  );
  await page.getByText(/ lines? of code$/).waitFor();

  const storage = await context.newPage();
  await storage.goto(`${extensionUrl}/settings.html#storage`);
  const branchLink = storage.locator(
    'a[href="https://github.com/culverin/bootstrap-fixture/tree/feature"]',
  );
  await storage.locator("#cache-list").locator(branchLink).waitFor();
  const branchRow = storage.locator("#cache-list tr", { has: branchLink });
  assert.match(
    (await branchRow.locator("td").first().textContent()) ?? "",
    /^culverin\/bootstrap-fixturefeature, b{7}, mostly /,
  );
  assert.equal(
    await branchRow.locator("td [data-tip]").first().getAttribute("data-tip"),
    "Not the default branch (main)",
  );
  const defaultRow = storage.locator("#cache-list tr", {
    has: storage.locator(
      'a[href="https://github.com/culverin/bootstrap-fixture"]',
    ),
  });
  assert.match(
    (await defaultRow.locator("td").first().textContent()) ?? "",
    /^culverin\/bootstrap-fixturemain, [0-9a-f]{7}, mostly /,
  );
  await storage.close();

  await clearPublicCache();
  await settingsPage.evaluate(() =>
    chrome.storage.sync.set({ "culverin.countTrigger": "open" }),
  );
  const defaultRoot = await summary.elementHandle();
  await page.evaluate(() =>
    history.pushState({}, "", "/culverin/bootstrap-fixture/tree/feature"),
  );
  await page.waitForFunction((root) => !root?.isConnected, defaultRoot);
  await page.getByText(/ lines? of code$/).waitFor();
  assert.deepEqual(await archives(), [branchSha, publicSha, branchSha]);
  const tabId = state.repositoryTabId;
  assert.ok(typeof tabId === "number");
  const pushTotal = (ref: string, total: number) =>
    worker.evaluate(
      async ({ tabId, ref, total }) => {
        await chrome.tabs.sendMessage(tabId, {
          protocolVersion: 1,
          type: "summary.update",
          repository: { owner: "culverin", name: "bootstrap-fixture" },
          ref,
          defaultBranch: "main",
          totalCodeLines: total,
          uncountedFiles: 0,
          totalFiles: 1,
          totalBytes: 1,
          customIgnore: false,
        });
      },
      { tabId, ref, total },
    );
  const branchTotal = await page.getByText(/ lines? of code$/).textContent();
  await pushTotal("", 9_900);
  await page.waitForTimeout(500);
  assert.equal(
    await page.getByText(/ lines? of code$/).textContent(),
    branchTotal,
  );
  await pushTotal("feature", 4_242);
  await page.getByText("4.2k lines of code").waitFor();
  await settingsPage.evaluate(() =>
    chrome.storage.sync.remove("culverin.countTrigger"),
  );

  await page.evaluate(() =>
    history.replaceState({}, "", "/culverin/bootstrap-fixture"),
  );
  await worker.evaluate(() => {
    const scope = globalThis as typeof globalThis & {
      branchFetch?: typeof fetch;
    };
    if (scope.branchFetch) globalThis.fetch = scope.branchFetch;
  });
  fixtures.branches = {};
  await clearPublicCache();
  return { ...state };
}
