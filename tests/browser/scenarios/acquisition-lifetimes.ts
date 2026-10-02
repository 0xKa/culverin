import assert from "node:assert/strict";
import { gzipSync } from "node:zlib";
import { archive, encoder, entry } from "../../tar-fixture";
import type { runPartialResults } from "./partial-results";
export async function runAcquisitionLifetimes(
  state: Awaited<ReturnType<typeof runPartialResults>>,
) {
  const {
    worker,
    publicSha,
    page,
    openPopup,
    uncheckedStatus,
    clearPublicCache,
    fixtures,
    settingsPage,
    restart,
    interruptionCdp,
  } = state;

  let noiseState = 0x9e3779b9;

  const noise = Uint8Array.from({ length: 3 * 512 * 1024 }, () => {
    noiseState ^= noiseState << 13;
    noiseState ^= noiseState >>> 17;
    noiseState ^= noiseState << 5;
    return noiseState & 0xff;
  });

  const singleChunk = [
    ...gzipSync(
      archive(
        entry("fixture-abc123/src/main.rs", encoder.encode("fn main() {}\n")),
        entry("fixture-abc123/assets/noise.bin", noise),
      ),
    ),
  ];

  assert.ok(singleChunk.length > 1024 * 1024);

  await worker.evaluate(
    ({ bytes, sha }) => {
      const scope = globalThis as typeof globalThis & {
        singleChunkOriginalFetch?: typeof fetch;
      };
      scope.singleChunkOriginalFetch = fetch;
      globalThis.fetch = (async (input, init) => {
        if (String(input).endsWith(`/tarball/${sha}`)) {
          const body = Uint8Array.from(bytes);
          const response = new Response(
            new ReadableStream<Uint8Array>({
              start(controller) {
                controller.enqueue(body);
                controller.close();
              },
            }),
            { status: 200, headers: { "content-type": "application/gzip" } },
          );
          Object.defineProperty(response, "url", {
            value: `https://codeload.github.com/culverin/bootstrap-fixture/legacy.tar.gz/${sha}`,
          });
          return response;
        }
        return scope.singleChunkOriginalFetch!(input, init);
      }) as typeof fetch;
    },
    { bytes: singleChunk, sha: publicSha },
  );

  await page.reload();

  await page.getByText("Count lines of code").waitFor();

  const singleChunkPopup = await openPopup(page);

  await singleChunkPopup.getByText(uncheckedStatus).waitFor();

  await singleChunkPopup
    .getByRole("button", { name: "Analyze repository" })
    .click();

  await singleChunkPopup
    .getByText("Analyzed locally.")
    .waitFor({ timeout: 15_000 });

  assert.equal(
    await singleChunkPopup.locator("#code-lines").textContent(),
    "1 code lines",
  );

  await singleChunkPopup.close();

  await worker.evaluate(() => {
    const scope = globalThis as typeof globalThis & {
      singleChunkOriginalFetch?: typeof fetch;
    };
    if (scope.singleChunkOriginalFetch)
      globalThis.fetch = scope.singleChunkOriginalFetch;
    delete scope.singleChunkOriginalFetch;
  });

  await clearPublicCache();

  await page.reload();

  await page.getByText("Count lines of code").waitFor();

  fixtures.mode = "slow";

  const interruptedArchive = new Promise<void>((resolve) => {
    fixtures.slowArchiveStarted = resolve;
  });

  const interruptedPopup = await openPopup(page);

  await interruptedPopup
    .getByRole("button", { name: "Analyze repository" })
    .click();

  await interruptedArchive;

  const competing = await settingsPage.evaluate(async () => {
    const navigationId = crypto.randomUUID();
    const requestId = crypto.randomUUID();
    const send = (type: string, extra: Record<string, unknown> = {}) =>
      new Promise<Record<string, unknown>>((resolve) =>
        chrome.runtime.sendMessage(
          {
            protocolVersion: 1,
            type,
            requestId: crypto.randomUUID(),
            navigationId,
            ...extra,
          },
          resolve,
        ),
      );
    const analysis = new Promise<Record<string, unknown>>((resolve) =>
      chrome.runtime.sendMessage(
        {
          protocolVersion: 1,
          type: "analysis.request",
          requestId,
          navigationId,
          owner: "culverin",
          name: "bootstrap-other",
        },
        resolve,
      ),
    );
    let status = await send("analysis.status");
    for (let attempt = 0; attempt < 50 && status.state === "idle"; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 20));
      status = await send("analysis.status");
    }
    const canceled = await send("analysis.cancel", {
      targetRequestId: requestId,
    });
    return { status, canceled, analysis: await analysis };
  });

  assert.equal(competing.status.state, "queued");

  assert.equal(competing.canceled.state, "canceled");

  assert.equal(competing.analysis.code, "analysis_canceled");

  assert.ok(restart.versionId);

  await interruptionCdp.send("ServiceWorker.stopWorker", {
    versionId: restart.versionId!,
  });

  await interruptedPopup
    .getByText(/Analysis was interrupted/)
    .waitFor({ timeout: 15_000 });

  assert.equal(await interruptedPopup.locator(".culverin-spinner").count(), 0);

  await page.waitForTimeout(1700);

  assert.equal(fixtures.archiveRequests, 6);

  await interruptedPopup.close();

  fixtures.mode = "ok";

  const recoveryPopup = await openPopup(page);

  await recoveryPopup
    .getByRole("button", { name: "Analyze repository" })
    .click();

  await recoveryPopup
    .getByText(/Repository unavailable or access is restricted/)
    .waitFor({ timeout: 15_000 });

  assert.equal(fixtures.archiveRequests, 7);

  await recoveryPopup.close();

  await interruptionCdp.detach();

  fixtures.mode = "shared";

  await page.reload();

  await page.getByText("Count lines of code").waitFor();

  const detachedArchive = new Promise<void>((resolve) => {
    fixtures.slowArchiveStarted = resolve;
  });

  const detachedPopup = await openPopup(page);

  await detachedPopup
    .getByRole("button", { name: "Analyze repository" })
    .click();

  await detachedArchive;

  await detachedPopup.close();

  await page.waitForTimeout(300);

  const continuingJobs = await settingsPage.evaluate(async () => {
    const state = await chrome.storage.session.get("github.job");
    return state["github.job"] as { owner: string }[] | undefined;
  });

  assert.equal(continuingJobs?.length, 1);

  const detachedJobs = await settingsPage.evaluate(async () => {
    for (let attempt = 0; attempt < 500; attempt++) {
      const state = await chrome.storage.session.get("github.job");
      if (state["github.job"] === undefined) return undefined;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    return (await chrome.storage.session.get("github.job"))["github.job"];
  });

  assert.equal(detachedJobs, undefined);

  assert.equal(fixtures.archiveRequests, 8);

  assert.equal(await page.getByText("Count lines of code").count(), 1);

  fixtures.mode = "ok";
  return { ...state };
}
