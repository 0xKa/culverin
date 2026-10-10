import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { archive, entry } from "../../tar-fixture";
import type { runIgnoreAccess } from "./ignore-access";
export async function runPartialResults(
  state: Awaited<ReturnType<typeof runIgnoreAccess>>,
) {
  const {
    context,
    harness,
    page,
    fixtures,
    settingsPage,
    clearPublicCache,
    worker,
    publicSha,
    openPopup,
    uncheckedStatus,
    summary,
  } = state;

  const interruptionCdp = await context.newCDPSession(harness);

  const restart = { versionId: undefined as string | undefined };

  interruptionCdp.on("ServiceWorker.workerVersionUpdated", (event) => {
    for (const version of event.versions)
      if (version.status === "activated") restart.versionId = version.versionId;
  });

  await interruptionCdp.send("ServiceWorker.enable");

  await page.goto("https://github.com/culverin/bootstrap-fixture");

  await page.getByText("1 line of code", { exact: true }).waitFor();

  assert.equal(fixtures.archiveRequests, 5);

  fixtures.mode = "private";

  const privateObservation = await settingsPage.evaluate(
    () =>
      new Promise<Record<string, unknown>>((resolve) =>
        chrome.runtime.sendMessage(
          {
            protocolVersion: 1,
            type: "repository.lookup",
            requestId: crypto.randomUUID(),
            navigationId: crypto.randomUUID(),
            owner: "culverin",
            name: "bootstrap-fixture",
          },
          resolve,
        ),
      ),
  );

  assert.equal(
    (privateObservation.resolution as { visibility: string }).visibility,
    "private",
  );

  const afterPrivate = await settingsPage.evaluate(async () => {
    const state = await chrome.storage.local.get("culverin.public-results.v1");
    return (state["culverin.public-results.v1"] as { entries: unknown[] })
      .entries.length;
  });

  assert.equal(afterPrivate, 0);

  fixtures.mode = "ok";

  await clearPublicCache();

  const partialBytes = [
    ...readFileSync("tests/fixtures/archive-partial.tar.gz"),
  ];

  const installPartialArchive = async (bytes: number[]) =>
    worker.evaluate(
      ({ bytes, sha }) => {
        const scope = globalThis as typeof globalThis & {
          partialOriginalFetch?: typeof fetch;
          partialArchiveRequests?: number;
        };
        scope.partialOriginalFetch ??= fetch;
        globalThis.fetch = (async (input, init) => {
          if (String(input).endsWith(`/tarball/${sha}`)) {
            scope.partialArchiveRequests =
              (scope.partialArchiveRequests ?? 0) + 1;
            const response = new Response(Uint8Array.from(bytes), {
              status: 200,
              headers: { "content-type": "application/gzip" },
            });
            Object.defineProperty(response, "url", {
              value: `https://codeload.github.com/culverin/bootstrap-fixture/legacy.tar.gz/${sha}`,
            });
            return response;
          }
          return scope.partialOriginalFetch!(input, init);
        }) as typeof fetch;
      },
      { bytes, sha: publicSha },
    );

  await installPartialArchive(partialBytes);

  await page.reload();

  await page.getByText("Analyze with Culverin").waitFor();

  const partialPopup = await openPopup(page);

  await partialPopup.getByText(uncheckedStatus).waitFor();

  await partialPopup
    .getByRole("button", { name: "Analyze repository" })
    .click();

  await partialPopup
    .getByText("Partial local analysis.")
    .waitFor({ timeout: 15_000 });

  await partialPopup
    .getByText(
      "1 source file was too large to count and is not included in these totals.",
    )
    .waitFor();

  const oversizedLink = partialPopup.getByRole("link", {
    name: "src/too-large.rs",
    exact: true,
  });

  await oversizedLink.waitFor();

  assert.equal(
    await oversizedLink.getAttribute("href"),
    `https://github.com/culverin/bootstrap-fixture/blob/${publicSha}/src/too-large.rs`,
  );

  assert.equal(await oversizedLink.getAttribute("target"), "_blank");

  await partialPopup.getByText("The per-file limit is 8 MiB.").waitFor();

  assert.equal(await partialPopup.locator("#oversized-file-list").count(), 0);

  assert.match(
    (await partialPopup.locator("#oversized-files li").textContent()) ?? "",
    /8 MiB/,
  );

  const partialRow = {
    text: "0+ lines of code",
    title: "0 lines of code, not including 1 source file too large to count",
  };

  const readRow = () =>
    summary.evaluate((host) => {
      const row = host.shadowRoot?.querySelector(".row");
      return { text: row?.textContent, title: row?.getAttribute("title") };
    });

  await page.getByText("0+", { exact: true }).waitFor();

  assert.deepEqual(await readRow(), partialRow);

  await partialPopup.close();

  const persistedPartial = await settingsPage.evaluate(async () => {
    const state = await chrome.storage.local.get("culverin.public-results.v1");
    return (state["culverin.public-results.v1"] as { entries: unknown[] })
      .entries.length;
  });

  assert.equal(persistedPartial, 1);

  await page.reload();

  await page.getByText("0+", { exact: true }).waitFor();

  assert.deepEqual(await readRow(), partialRow);

  const cachedPartialPopup = await openPopup(page);

  await cachedPartialPopup
    .getByRole("link", { name: "src/too-large.rs", exact: true })
    .waitFor();

  assert.equal(
    await worker.evaluate(
      () =>
        (globalThis as typeof globalThis & { partialArchiveRequests?: number })
          .partialArchiveRequests,
    ),
    1,
  );

  await cachedPartialPopup.close();

  const legacyPartial = await settingsPage.evaluate(async () => {
    const state = await chrome.storage.local.get("culverin.public-results.v1");
    const snapshot = state["culverin.public-results.v1"] as {
      entries: {
        bytes: number;
        result: { coverage: { oversizedFiles?: unknown[] } };
      }[];
    };
    const saved = snapshot.entries[0]!;
    delete saved.result.coverage.oversizedFiles;
    saved.bytes = new TextEncoder().encode(
      JSON.stringify({ ...saved, bytes: 0 }),
    ).byteLength;
    return snapshot;
  });

  await clearPublicCache();

  await settingsPage.evaluate(async (snapshot) => {
    await chrome.storage.local.set({ "culverin.public-results.v1": snapshot });
  }, legacyPartial);

  const legacyControl = await context.newCDPSession(page);

  await legacyControl.send("ServiceWorker.enable");

  await legacyControl.send("ServiceWorker.stopAllWorkers");

  await legacyControl.detach();

  await page.reload();

  await page.getByText("0+", { exact: true }).waitFor();

  await installPartialArchive(partialBytes);

  const legacyPopup = await openPopup(page);

  await legacyPopup
    .getByText(
      "File names aren't available for this saved result. Reanalyze to see them.",
    )
    .waitFor();

  assert.equal(await legacyPopup.locator("#oversized-files a").count(), 0);

  assert.equal(
    await worker.evaluate(
      () =>
        (globalThis as typeof globalThis & { partialArchiveRequests?: number })
          .partialArchiveRequests,
    ),
    undefined,
  );

  await legacyPopup.getByRole("button", { name: "Reanalyze" }).click();

  await legacyPopup
    .getByRole("link", { name: "src/too-large.rs", exact: true })
    .waitFor();

  assert.equal(
    await worker.evaluate(
      () =>
        (globalThis as typeof globalThis & { partialArchiveRequests?: number })
          .partialArchiveRequests,
    ),
    1,
  );

  await legacyPopup.getByRole("button", { name: "Reanalyze" }).click();

  await legacyPopup
    .getByText(
      "No new commit since the last analysis. Showing the cached result.",
    )
    .waitFor();

  assert.equal(
    await worker.evaluate(
      () =>
        (globalThis as typeof globalThis & { partialArchiveRequests?: number })
          .partialArchiveRequests,
    ),
    1,
  );

  await legacyPopup.close();

  await clearPublicCache();

  const longOversizedPath = `src/${"nested/".repeat(8)}larger #?%.rs`;

  await installPartialArchive([
    ...gzipSync(
      archive(
        entry(
          `fixture-abc123/${longOversizedPath}`,
          new Uint8Array(9 * 1024 * 1024).fill(120),
        ),
        entry(
          "fixture-abc123/src/too-large.rs",
          new Uint8Array(8 * 1024 * 1024 + 1).fill(120),
        ),
      ),
    ),
  ]);

  await page.reload();

  await page.getByText("Analyze with Culverin").waitFor();

  const multiplePartialPopup = await openPopup(page);

  await multiplePartialPopup.setViewportSize({ width: 360, height: 560 });

  await multiplePartialPopup
    .getByRole("button", { name: "Analyze repository" })
    .click();

  await multiplePartialPopup
    .getByText(
      "2 source files were too large to count and are not included in these totals.",
    )
    .waitFor();

  const oversizedDisclosure = multiplePartialPopup.locator(
    "#oversized-file-list",
  );

  assert.equal(await oversizedDisclosure.locator("ul").isVisible(), false);

  await oversizedDisclosure.getByText("Show files", { exact: true }).click();

  assert.deepEqual(await oversizedDisclosure.locator("a").allTextContents(), [
    longOversizedPath,
    "src/too-large.rs",
  ]);

  assert.equal(
    await oversizedDisclosure.locator("a").first().getAttribute("href"),
    `https://github.com/culverin/bootstrap-fixture/blob/${publicSha}/${longOversizedPath.split("/").map(encodeURIComponent).join("/")}`,
  );

  await multiplePartialPopup.screenshot({
    path: "/tmp/culverin-oversized-files.png",
    fullPage: true,
  });

  assert.equal(
    await multiplePartialPopup.evaluate(
      () =>
        document.documentElement.scrollWidth <=
        document.documentElement.clientWidth,
    ),
    true,
  );

  await oversizedDisclosure.getByText("Show files", { exact: true }).click();

  await oversizedDisclosure
    .locator("ul")
    .waitFor({ state: "hidden", timeout: 2000 });

  await multiplePartialPopup.close();

  await worker.evaluate(() => {
    const scope = globalThis as typeof globalThis & {
      partialOriginalFetch?: typeof fetch;
    };
    if (scope.partialOriginalFetch)
      globalThis.fetch = scope.partialOriginalFetch;
    delete scope.partialOriginalFetch;
  });

  await clearPublicCache();
  return { ...state, restart, interruptionCdp };
}
