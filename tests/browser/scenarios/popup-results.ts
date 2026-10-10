import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { runPagePopupLifetimes } from "./page-popup-lifetimes";
export async function runPopupResults(
  state: Awaited<ReturnType<typeof runPagePopupLifetimes>>,
) {
  const {
    context,
    worker,
    publicSha,
    page,
    openActionPopup,
    actionPopup,
    harness,
    openPopup,
    fixtures,
    repositoryTabId,
  } = state;

  const settingsPage = await context.newPage();

  await settingsPage.goto(
    `chrome-extension://${new URL(worker.url()).host}/settings.html#storage`,
  );

  await settingsPage.locator("#github-token").waitFor({ state: "attached" });

  assert.deepEqual(
    await settingsPage
      .locator('input:not([type="checkbox"]):not([type="radio"])')
      .evaluateAll((inputs) =>
        inputs.map((input) => [input.id, input.getAttribute("type")]),
      ),
    [["github-token", "password"]],
  );

  assert.equal(await settingsPage.locator("textarea").count(), 1);

  const settingsNav = settingsPage.getByRole("navigation", {
    name: "Settings sections",
  });

  assert.equal(
    await settingsNav
      .getByRole("link", { name: "Storage" })
      .getAttribute("aria-current"),
    "page",
  );

  assert.equal(await settingsPage.locator("#rules").isHidden(), true);

  await settingsPage
    .getByRole("button", { name: "Clear public results" })
    .click();

  await settingsPage.getByText("Public results cleared.").waitFor();

  await settingsPage
    .locator("#cache-summary", { hasText: "No saved results." })
    .waitFor();

  await settingsNav.getByRole("link", { name: "Culverin ignore" }).click();

  await settingsPage.locator("#rules").waitFor({ state: "visible" });

  assert.equal(new URL(settingsPage.url()).hash, "#ignore");

  assert.equal(
    await settingsPage
      .getByRole("button", { name: "Clear public results" })
      .isHidden(),
    true,
  );

  await settingsPage.locator("#rules").fill("draft\n");

  await settingsNav.getByRole("link", { name: "Storage" }).focus();

  await settingsPage.keyboard.press("Enter");

  await settingsPage
    .getByRole("button", { name: "Clear public results" })
    .waitFor({ state: "visible" });

  assert.equal(
    await settingsNav
      .getByRole("link", { name: "Storage" })
      .evaluate((link) => getComputedStyle(link).outlineStyle),
    "solid",
  );

  await settingsPage.goBack();

  await settingsPage.locator("#rules").waitFor({ state: "visible" });

  assert.equal(await settingsPage.locator("#rules").inputValue(), "draft\n");

  await settingsPage.locator("#rules").fill("");

  const publicFixtureBytes = [
    ...readFileSync("tests/fixtures/archive-source.tar.gz"),
  ];

  await worker.evaluate(
    ({ bytes, sha }) => {
      const scope = globalThis as typeof globalThis & {
        fixtureOriginalFetch?: typeof fetch;
        fixtureFetchCount?: number;
        fixtureRelease?: () => void;
      };
      scope.fixtureOriginalFetch = fetch;
      scope.fixtureFetchCount = 0;
      globalThis.fetch = (async (input, init) => {
        if (String(input).endsWith(`/tarball/${sha}`)) {
          scope.fixtureFetchCount = (scope.fixtureFetchCount ?? 0) + 1;
          await new Promise<void>((resolve) => {
            scope.fixtureRelease = resolve;
          });
          const response = new Response(Uint8Array.from(bytes), {
            status: 200,
            headers: { "content-type": "application/gzip" },
          });
          Object.defineProperty(response, "url", {
            value: `https://codeload.github.com/culverin/bootstrap-fixture/legacy.tar.gz/${sha}`,
          });
          return response;
        }
        return scope.fixtureOriginalFetch!(input, init);
      }) as typeof fetch;
    },
    { bytes: publicFixtureBytes, sha: publicSha },
  );

  await page.goto("https://github.com/culverin/bootstrap-fixture");

  await page.getByText("Analyze with Culverin").waitFor();

  assert.equal(
    await worker.evaluate(
      () =>
        (globalThis as typeof globalThis & { fixtureFetchCount?: number })
          .fixtureFetchCount,
    ),
    0,
  );

  await openActionPopup(page);

  const resultPopup = await actionPopup();

  await resultPopup.status(/^Analyze checks GitHub and counts/);

  assert.equal(
    await worker.evaluate(
      () =>
        (globalThis as typeof globalThis & { fixtureFetchCount?: number })
          .fixtureFetchCount,
    ),
    0,
  );

  await resultPopup.click("#analyze");

  await worker.evaluate(async () => {
    const scope = globalThis as typeof globalThis & {
      fixtureRelease?: () => void;
    };
    for (let attempt = 0; attempt < 200 && !scope.fixtureRelease; attempt++)
      await new Promise((resolve) => setTimeout(resolve, 20));
    if (!scope.fixtureRelease) throw new Error("Archive request did not start");
  });

  await resultPopup.close();

  await page.waitForTimeout(300);

  const heldPopupJobs = await harness.evaluate(async () => {
    const state = await chrome.storage.session.get("github.job");
    return state["github.job"] as { owner: string }[] | undefined;
  });

  assert.equal(heldPopupJobs?.length, 1);

  assert.equal(await page.getByText("Analyze with Culverin").count(), 1);

  const resumedPopup = await openPopup(page);

  await resumedPopup
    .getByText("Analysis in progress. Closing the popup does not stop it.")
    .waitFor();

  await resumedPopup.getByRole("button", { name: "Cancel analysis" }).waitFor();

  await resumedPopup.locator("#analysis-loader .culverin-dots").waitFor();

  assert.equal(await resumedPopup.locator("#analyze").isVisible(), false);

  await worker.evaluate(() =>
    (
      globalThis as typeof globalThis & { fixtureRelease?: () => void }
    ).fixtureRelease?.(),
  );

  await resumedPopup
    .getByText("Analyzed locally.")
    .waitFor({ timeout: 15_000 });

  await resumedPopup.getByText("1 code lines", { exact: true }).waitFor();

  assert.equal(await resumedPopup.locator("#analysis-loader").count(), 0);

  await resumedPopup
    .getByText(
      /Source profile coverage: 2 of 14 regular files counted; 12 skipped \(0 excluded by Culverin ignore, 12 other files,/,
    )
    .waitFor();

  assert.equal(
    await resumedPopup.locator("#clone-size").textContent(),
    "Estimated clone size ≈ 2 MB",
  );

  assert.equal(
    await resumedPopup.locator("#snapshot-size").textContent(),
    "47 B",
  );

  assert.equal(await resumedPopup.locator("#text-lines").textContent(), "1");

  assert.match(
    (await resumedPopup.locator("#file-count").textContent()) ?? "",
    /^\d[\d,]* files?$/,
  );

  assert.deepEqual(
    await resumedPopup
      .locator("#detail-content > section")
      .evaluateAll((sections) =>
        sections.map((section) => {
          const heading = section.querySelector("h2");
          const list = section.querySelector(":scope > ul");
          return [
            heading?.textContent,
            heading?.nextElementSibling?.textContent,
            list?.getAttribute("aria-label"),
            Array.from(
              list?.children ?? [],
              (item) => item.querySelector(".sr-only")?.textContent,
            ),
          ];
        }),
      ),
    [
      [
        "Code",
        "1 code lines, 1 files",
        "Languages by code lines",
        ["Rust: 1 code lines (100.0% of code lines), 1 files"],
      ],
      [
        "Text",
        "1 text lines, 1 files",
        "Text formats by text lines",
        ["Plain Text: 1 text lines (100.0% of text lines), 1 files"],
      ],
      [
        "Other files",
        "13 lines, 12 files",
        "Other files by lines",
        [
          ".golden: 2 lines, 1 files",
          ...Array.from(
            { length: 9 },
            (_, index) => `.zz0${index + 1}: 1 lines, 1 files`,
          ),
        ],
      ],
    ],
  );

  const moreOther = resumedPopup.locator("#more-other-files");

  const moreList = moreOther.getByRole("list", {
    name: "More other files by lines",
  });

  assert.equal(await moreList.isVisible(), false);

  await moreOther.getByText("Show 2 more").click();

  assert.deepEqual(await moreList.locator("li .sr-only").allTextContents(), [
    ".zz10: 1 lines, 1 files",
    ".zz11: 1 lines, 1 files",
  ]);

  assert.equal(await moreList.isVisible(), true);

  assert.equal(await moreOther.getByText("Show fewer").isVisible(), true);

  assert.equal(await moreOther.getByText("Show 2 more").isVisible(), false);

  await moreOther.getByText("Show fewer").click();

  assert.equal(await moreList.isVisible(), false);

  await page.getByText("1 line of code", { exact: true }).waitFor();

  const disclosure = resumedPopup.locator("#details");

  await disclosure.locator(":scope > summary").focus();

  await resumedPopup.keyboard.press("Enter");

  assert.equal(
    await disclosure.evaluate(
      (element) => (element as HTMLDetailsElement).open,
    ),
    false,
  );

  await resumedPopup.keyboard.press("Enter");

  assert.equal(
    await disclosure.evaluate(
      (element) => (element as HTMLDetailsElement).open,
    ),
    true,
  );

  assert.equal(
    await resumedPopup.locator("#status").textContent(),
    "Analyzed locally.",
  );

  const badge = resumedPopup.getByRole("img", { name: "Fresh" });

  assert.equal(await badge.getAttribute("aria-describedby"), "status");

  await badge.hover();

  assert.equal(
    await badge.evaluate(
      (element) => getComputedStyle(element, "::after").content,
    ),
    '"Analyzed locally."',
  );

  assert.equal(
    await badge.evaluate(
      (element) => getComputedStyle(element, "::after").visibility,
    ),
    "visible",
  );

  const accessibility = await context.newCDPSession(resumedPopup);

  const tree = await accessibility.send("Accessibility.getFullAXTree");

  assert.ok(
    tree.nodes.some(
      (node) =>
        node.role?.value === "status" &&
        node.properties?.some(
          (property) =>
            property.name === "live" && property.value?.value === "polite",
        ),
    ),
  );

  await accessibility.detach();

  await resumedPopup
    .locator("#detail-content")
    .getByText(new RegExp(publicSha.slice(0, 12)))
    .waitFor();

  assert.equal(
    await worker.evaluate(
      () =>
        (globalThis as typeof globalThis & { fixtureFetchCount?: number })
          .fixtureFetchCount,
    ),
    1,
  );

  const savedPublicResults = await settingsPage.evaluate(() =>
    chrome.storage.local.get("culverin.public-results.v1"),
  );

  await resumedPopup.close();

  await page.reload();

  await page.getByText("1 line of code", { exact: true }).waitFor();

  assert.equal(
    await worker.evaluate(
      () =>
        (globalThis as typeof globalThis & { fixtureFetchCount?: number })
          .fixtureFetchCount,
    ),
    1,
  );

  const countRow = page.getByRole("button", {
    name: "1 line of code",
    exact: true,
  });

  await page.bringToFront();

  await countRow.hover();

  assert.equal(
    await countRow.evaluate((row) => getComputedStyle(row).color),
    "rgb(9, 105, 218)",
  );

  await countRow.click();

  const detailsPopup = await actionPopup();

  await detailsPopup.status(/^Cached local analysis/);

  await detailsPopup.close();

  await page.mouse.move(0, 0);

  const restartPopup = await openPopup(page);

  const cachedStatus =
    "Cached local analysis, checked on GitHub in the last 20 minutes. Select Reanalyze to check for a newer commit.";

  await restartPopup.getByText(cachedStatus).waitFor();

  await restartPopup.locator("#details > summary").click();

  const resultSnapshot = async () =>
    restartPopup.evaluate(() => ({
      totals: [
        "code-lines",
        "file-count",
        "text-lines",
        "metrics",
        "snapshot-size",
        "clone-size",
      ].map((id) => document.getElementById(id)?.textContent),
      details: document.getElementById("detail-content")?.innerHTML,
      open: (document.getElementById("details") as HTMLDetailsElement).open,
    }));

  const beforeReanalyzeResult = await resultSnapshot();

  assert.equal(beforeReanalyzeResult.open, false);

  const beforeReanalyzeApiRequests = fixtures.apiRequests;

  const beforeReanalyzeArchiveRequests = fixtures.archiveRequests;

  const restartControl = await context.newCDPSession(page);

  await restartControl.send("ServiceWorker.enable");

  await restartControl.send("ServiceWorker.stopAllWorkers");

  await restartControl.detach();

  await page.waitForTimeout(1000);

  let releaseMetadata!: () => void;

  fixtures.metadataGate = new Promise<void>((resolve) => {
    releaseMetadata = resolve;
  });

  await restartPopup.getByRole("button", { name: "Reanalyze" }).click();

  await restartPopup.getByText("Checking for updates…").waitFor();

  await restartPopup.locator("#analysis-loader .culverin-dots").waitFor();

  assert.equal(await restartPopup.locator("#analyze").isVisible(), false);

  assert.equal(
    await restartPopup.locator("#analysis-loader #cancel").isVisible(),
    true,
  );

  assert.equal(
    await restartPopup.evaluate(() => document.activeElement?.id),
    "cancel",
  );

  assert.deepEqual(await resultSnapshot(), beforeReanalyzeResult);

  fixtures.metadataGate = undefined;

  releaseMetadata();

  await restartPopup
    .getByText(
      "No new commit since the last analysis. Showing the cached result.",
    )
    .waitFor();

  await restartPopup.getByText("1 code lines", { exact: true }).waitFor();

  assert.equal(await restartPopup.locator("#analysis-loader").count(), 0);

  assert.equal(
    await restartPopup.locator("#analyze").textContent(),
    "Reanalyze",
  );

  assert.equal(
    await restartPopup.evaluate(() => document.activeElement?.id),
    "analyze",
  );

  assert.equal(fixtures.apiRequests, beforeReanalyzeApiRequests + 2);

  assert.equal(fixtures.archiveRequests, beforeReanalyzeArchiveRequests);

  assert.deepEqual(await resultSnapshot(), beforeReanalyzeResult);

  fixtures.metadataGate = new Promise<void>((resolve) => {
    releaseMetadata = resolve;
  });

  await restartPopup.getByRole("button", { name: "Reanalyze" }).click();

  await restartPopup.locator("#analysis-loader .culverin-dots").waitFor();

  await restartPopup.getByRole("button", { name: "Cancel analysis" }).click();

  await restartPopup.getByText("Analysis canceled.").waitFor();

  assert.equal(await restartPopup.locator("#analysis-loader").count(), 0);

  assert.equal(await restartPopup.locator("#analyze").isEnabled(), true);

  assert.deepEqual(await resultSnapshot(), beforeReanalyzeResult);

  fixtures.metadataGate = undefined;

  releaseMetadata();

  await harness.waitForFunction(async () => {
    const state = await chrome.storage.session.get("github.job");
    return !(state["github.job"] as unknown[] | undefined)?.length;
  });

  fixtures.metadataFailure = true;

  await restartPopup.getByRole("button", { name: "Reanalyze" }).click();

  await restartPopup
    .getByText("GitHub could not be reached.", { exact: true })
    .waitFor();

  assert.equal(await restartPopup.locator("#analysis-loader").count(), 0);

  assert.deepEqual(await resultSnapshot(), beforeReanalyzeResult);

  fixtures.metadataFailure = false;

  fixtures.sha = "b".repeat(40);

  await worker.evaluate(
    ({ bytes, sha }) => {
      const scope = globalThis as typeof globalThis & {
        reanalysisOriginalFetch?: typeof fetch;
        reanalysisRelease?: () => void;
      };
      scope.reanalysisOriginalFetch = fetch;
      globalThis.fetch = (async (input, init) => {
        if (!String(input).endsWith(`/tarball/${sha}`))
          return scope.reanalysisOriginalFetch!(input, init);
        const response = new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              scope.reanalysisRelease = () => {
                controller.enqueue(Uint8Array.from(bytes));
                controller.close();
              };
            },
          }),
          {
            status: 200,
            headers: { "content-type": "application/gzip" },
          },
        );
        Object.defineProperty(response, "url", {
          value: `https://codeload.github.com/culverin/bootstrap-fixture/legacy.tar.gz/${sha}`,
        });
        return response;
      }) as typeof fetch;
    },
    { bytes: publicFixtureBytes, sha: fixtures.sha },
  );

  await restartPopup.getByRole("button", { name: "Reanalyze" }).click();

  await restartPopup
    .getByText("Downloading source snapshot from GitHub…")
    .waitFor();

  await restartPopup.locator("#analysis-loader .culverin-dots").waitFor();

  assert.deepEqual(await resultSnapshot(), beforeReanalyzeResult);

  await worker.evaluate(async () => {
    const scope = globalThis as typeof globalThis & {
      reanalysisRelease?: () => void;
    };
    for (let attempt = 0; attempt < 200 && !scope.reanalysisRelease; attempt++)
      await new Promise((resolve) => setTimeout(resolve, 20));
    if (!scope.reanalysisRelease)
      throw new Error("Reanalysis archive did not start");
    scope.reanalysisRelease();
  });

  await restartPopup.locator("#cancel").waitFor({ state: "hidden" });

  assert.equal(
    await restartPopup.locator("#status").textContent(),
    "Analyzed locally.",
  );

  assert.equal(await restartPopup.locator("#analysis-loader").count(), 0);

  assert.match(
    (await restartPopup.locator("#snapshot-size").getAttribute("title")) ?? "",
    new RegExp(
      `^Total size of the files at commit ${fixtures.sha.slice(0, 12)},`,
    ),
  );

  assert.equal((await resultSnapshot()).open, false);

  assert.match(
    (await resultSnapshot()).details ?? "",
    new RegExp(fixtures.sha.slice(0, 12)),
  );

  await worker.evaluate(() => {
    const scope = globalThis as typeof globalThis & {
      reanalysisOriginalFetch?: typeof fetch;
      reanalysisRelease?: () => void;
    };
    if (scope.reanalysisOriginalFetch)
      globalThis.fetch = scope.reanalysisOriginalFetch;
    delete scope.reanalysisOriginalFetch;
    delete scope.reanalysisRelease;
  });

  fixtures.sha = publicSha;

  await settingsPage.evaluate(
    (state) => chrome.storage.local.set(state),
    savedPublicResults,
  );

  await restartPopup.getByRole("button", { name: "Reanalyze" }).click();

  await restartPopup.getByText(cachedStatus).waitFor();

  assert.deepEqual(await resultSnapshot(), beforeReanalyzeResult);

  const impostorDisconnected = await harness.evaluate(
    () =>
      new Promise<boolean>((resolve) => {
        const impostor = chrome.runtime.connect({ name: "culverin.popup" });
        impostor.onDisconnect.addListener(() => resolve(true));
        setTimeout(() => resolve(false), 2000);
      }),
  );

  assert.equal(impostorDisconnected, true);

  const messageChannel = await restartPopup.evaluate(
    (tabId) =>
      new Promise<string>((resolve) =>
        chrome.runtime.sendMessage(
          {
            protocolVersion: 1,
            type: "analysis.status",
            requestId: crypto.randomUUID(),
            navigationId: crypto.randomUUID(),
            tabId,
          },
          () => resolve(chrome.runtime.lastError ? "rejected" : "handled"),
        ),
      ),
    repositoryTabId,
  );

  assert.equal(messageChannel, "rejected");

  await restartPopup.close();

  const isolation = await context.newCDPSession(page);

  const isolatedContexts: { id: number; origin: string }[] = [];

  isolation.on("Runtime.executionContextCreated", ({ context }) => {
    if (context.auxData?.type === "isolated")
      isolatedContexts.push({ id: context.id, origin: context.origin });
  });

  await isolation.send("Runtime.enable");

  const contentContext = isolatedContexts.find((item) =>
    item.origin.startsWith("chrome-extension://"),
  );

  assert.ok(contentContext, "content-script context exists");

  const storageAccess = await isolation.send("Runtime.evaluate", {
    contextId: contentContext.id,
    expression:
      "chrome.storage.local.get('culverin.public-results.v1').then(() => 'exposed', () => 'restricted')",
    awaitPromise: true,
    returnByValue: true,
  });

  assert.equal(storageAccess.result.value, "restricted");

  const ignoreAccess = await isolation.send("Runtime.evaluate", {
    contextId: contentContext.id,
    expression:
      "chrome.storage.sync.get('culverin.ignore').then(() => 'exposed', () => 'restricted')",
    awaitPromise: true,
    returnByValue: true,
  });

  assert.equal(ignoreAccess.result.value, "restricted");

  await isolation.detach();

  await worker.evaluate(() => {
    const scope = globalThis as typeof globalThis & {
      fixtureOriginalFetch?: typeof fetch;
      fixtureFetchCount?: number;
    };
    if (scope.fixtureOriginalFetch)
      globalThis.fetch = scope.fixtureOriginalFetch;
    delete scope.fixtureOriginalFetch;
    delete scope.fixtureFetchCount;
  });
  return {
    ...state,
    settingsPage,
    publicFixtureBytes,
    settingsNav,
    cachedStatus,
    savedPublicResults,
  };
}
