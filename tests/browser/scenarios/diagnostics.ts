import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { runLivePublic } from "./live-public";
export async function runDiagnostics(
  state: Awaited<ReturnType<typeof runLivePublic>>,
) {
  const { context, harness, worker, page, settingsPage, fixtures } = state;

  const capabilities = await harness.evaluate(() => {
    let gzip: boolean;
    try {
      new DecompressionStream("gzip");
      gzip = true;
    } catch {
      gzip = false;
    }
    return {
      gzip,
      session:
        typeof chrome.storage.session.get === "function" &&
        typeof chrome.storage.session.setAccessLevel === "function",
      contexts: typeof chrome.runtime.getContexts === "function",
      offscreen: typeof chrome.offscreen.createDocument === "function",
    };
  });

  assert.deepEqual(capabilities, {
    gzip: true,
    session: true,
    contexts: true,
    offscreen: true,
  });

  const outcome = await harness.evaluate(async () => {
    const rules = { repositoryId: "1", commitSha: "a".repeat(40) };
    const files = [
      {
        path: "fixture.rs",
        bytes: [...new TextEncoder().encode("fn main() {}\n")],
      },
    ];
    const send = (trap: boolean) =>
      new Promise<unknown>((resolve) =>
        chrome.runtime.sendMessage(
          { type: "counter.analyze", rules, files, trap },
          resolve,
        ),
      );
    const started = performance.now();
    const first = await send(false);
    const countMs = performance.now() - started;
    const trapped = await send(true);
    const recovered = await send(false);
    return {
      results: [first, trapped, recovered],
      countMs,
      memory:
        (performance as Performance & { memory?: { usedJSHeapSize: number } })
          .memory?.usedJSHeapSize ?? null,
    };
  });

  const [first, trapped, recovered] = outcome.results as [
    {
      ok: boolean;
      result: { totals: { files: number; lines: number; code: number } };
    },
    { ok: boolean; error: string },
    { ok: boolean },
  ];

  assert.equal(first.ok, true);

  assert.deepEqual(first.result.totals, {
    files: 1,
    lines: 1,
    code: 1,
    comments: 0,
    blanks: 0,
  });

  assert.deepEqual(trapped, { ok: false, error: "counter_failed" });

  assert.equal(recovered.ok, true);

  assert.deepEqual(first, recovered);

  const archiveFixture = [
    ...readFileSync("tests/fixtures/archive-source.tar.gz"),
  ];

  const archived = await harness.evaluate(
    (bytes) =>
      new Promise<Record<string, unknown>>((resolve) =>
        chrome.runtime.sendMessage(
          { type: "archive.fixture", requestId: crypto.randomUUID(), bytes },
          resolve,
        ),
      ),
    archiveFixture,
  );

  assert.equal(archived.state, "analyzed");

  const archivedResult = archived.result as {
    totals: { files: number; lines: number; code: number };
    otherFiles: unknown;
    coverage: {
      regularFiles: number;
      skippedByReason: { unsupported_language: number };
      complete: boolean;
    };
  };

  assert.equal(archivedResult.totals.files, 2);

  assert.equal(archivedResult.totals.lines, 2);

  assert.equal(archivedResult.totals.code, 1);

  assert.equal(archivedResult.coverage.regularFiles, 14);

  assert.equal(
    archivedResult.coverage.skippedByReason.unsupported_language,
    12,
  );

  assert.deepEqual(archivedResult.otherFiles, {
    files: 12,
    lines: 13,
    extensions: [
      { extension: ".golden", files: 1, lines: 2 },
      { extension: ".zz01", files: 1, lines: 1 },
      { extension: ".zz02", files: 1, lines: 1 },
      { extension: ".zz03", files: 1, lines: 1 },
      { extension: ".zz04", files: 1, lines: 1 },
      { extension: ".zz05", files: 1, lines: 1 },
      { extension: ".zz06", files: 1, lines: 1 },
      { extension: ".zz07", files: 1, lines: 1 },
      { extension: ".zz08", files: 1, lines: 1 },
      { extension: ".zz09", files: 1, lines: 1 },
      { extension: ".zz10", files: 1, lines: 1 },
      { extension: ".zz11", files: 1, lines: 1 },
    ],
    moreExtensions: 0,
  });

  assert.equal(archivedResult.coverage.complete, true);

  const archiveTransport = archived.transport as {
    compressedBytes: number;
    decompressedBytes: number;
  };

  assert.equal(archiveTransport.compressedBytes, archiveFixture.length);

  assert.ok(archiveTransport.decompressedBytes > archiveFixture.length);

  const archiveCancellation = await harness.evaluate(async (bytes) => {
    const requestId = crypto.randomUUID();
    const pending = new Promise<Record<string, unknown>>((resolve) =>
      chrome.runtime.sendMessage(
        { type: "archive.fixture", requestId, bytes, chunkDelayMs: 100 },
        resolve,
      ),
    );
    await new Promise((resolve) => setTimeout(resolve, 150));
    const canceled = await new Promise<Record<string, unknown>>((resolve) =>
      chrome.runtime.sendMessage(
        { type: "archive.fixture.cancel", targetRequestId: requestId },
        resolve,
      ),
    );
    return { canceled, outcome: await pending };
  }, archiveFixture);

  assert.equal(archiveCancellation.canceled.state, "canceled");

  assert.equal(archiveCancellation.outcome.state, "failed");

  assert.equal(archiveCancellation.outcome.code, "analysis_canceled");

  const afterArchiveCancel = await harness.evaluate(
    (bytes) =>
      new Promise<Record<string, unknown>>((resolve) =>
        chrome.runtime.sendMessage(
          { type: "archive.fixture", requestId: crypto.randomUUID(), bytes },
          resolve,
        ),
      ),
    archiveFixture,
  );

  assert.equal(afterArchiveCancel.state, "analyzed");

  const largeArchive = [...readFileSync("tests/fixtures/archive-large.tar.gz")];

  const largeRuns = await harness.evaluate(async (bytes) => {
    const measurements: {
      state: unknown;
      files: unknown;
      lines: unknown;
      wasmBytes: unknown;
      wasmLinearMemoryBytes: unknown;
      elapsedMs: number;
    }[] = [];
    for (let index = 0; index < 3; index++) {
      const started = performance.now();
      const outcome = await new Promise<Record<string, unknown>>((resolve) =>
        chrome.runtime.sendMessage(
          { type: "archive.fixture", requestId: crypto.randomUUID(), bytes },
          resolve,
        ),
      );
      const result = outcome.result as {
        totals?: { files?: unknown; lines?: unknown };
      };
      const transport = outcome.transport as { wasmBytes?: unknown };
      measurements.push({
        state: outcome.state,
        files: result?.totals?.files,
        lines: result?.totals?.lines,
        wasmBytes: transport?.wasmBytes,
        wasmLinearMemoryBytes: outcome.wasmLinearMemoryBytes,
        elapsedMs: performance.now() - started,
      });
    }
    return measurements;
  }, largeArchive);

  for (const run of largeRuns) {
    assert.equal(run.state, "analyzed");
    assert.equal(run.files, 1);
    assert.equal(run.lines, 800_000);
    assert.equal(run.wasmBytes, 8_000_000);
    assert.ok(typeof run.wasmLinearMemoryBytes === "number");
    assert.ok(run.wasmLinearMemoryBytes < 64 * 1024 * 1024);
  }

  assert.ok(
    largeRuns.every(
      (run) =>
        run.wasmLinearMemoryBytes === largeRuns[0]?.wasmLinearMemoryBytes,
    ),
  );

  console.log(`Repeated large archive jobs: ${JSON.stringify(largeRuns)}`);

  const slowArchive = await harness.evaluate(async (bytes) => {
    const started = performance.now();
    const outcome = await new Promise<Record<string, unknown>>((resolve) =>
      chrome.runtime.sendMessage(
        {
          type: "archive.fixture",
          requestId: crypto.randomUUID(),
          bytes,
          chunkDelayMs: 60,
        },
        resolve,
      ),
    );
    return {
      state: outcome.state,
      result: outcome.result,
      elapsedMs: performance.now() - started,
    };
  }, largeArchive);

  assert.equal(slowArchive.state, "analyzed");

  assert.ok(slowArchive.elapsedMs > 25_000);

  const slowResult = slowArchive.result as {
    totals: { files: number; lines: number };
    coverage: { complete: boolean };
  };

  assert.equal(slowResult.totals.files, 1);

  assert.equal(slowResult.totals.lines, 800_000);

  assert.equal(slowResult.coverage.complete, true);

  console.log(
    `Slow archive completed in ${Math.round(slowArchive.elapsedMs)} ms`,
  );

  const archiveCountCancellation = await harness.evaluate(async (bytes) => {
    const requestId = crypto.randomUUID();
    const counting = new Promise<void>((resolve) => {
      const listener = (message: unknown) => {
        if (
          message &&
          typeof message === "object" &&
          "type" in message &&
          message.type === "archive.counting" &&
          "requestId" in message &&
          message.requestId === requestId
        ) {
          chrome.runtime.onMessage.removeListener(listener);
          resolve();
        }
      };
      chrome.runtime.onMessage.addListener(listener);
    });
    const pending = new Promise<Record<string, unknown>>((resolve) =>
      chrome.runtime.sendMessage(
        { type: "archive.fixture", requestId, bytes, countBlockMs: 5_000 },
        resolve,
      ),
    );
    await Promise.race([
      counting,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("Counting did not start")), 5_000),
      ),
    ]);
    const canceledAt = performance.now();
    const canceled = await new Promise<Record<string, unknown>>((resolve) =>
      chrome.runtime.sendMessage(
        { type: "archive.fixture.cancel", targetRequestId: requestId },
        resolve,
      ),
    );
    return {
      canceled,
      outcome: await pending,
      cancelMs: performance.now() - canceledAt,
    };
  }, largeArchive);

  assert.equal(archiveCountCancellation.canceled.state, "canceled");

  assert.equal(archiveCountCancellation.outcome.state, "failed");

  assert.equal(archiveCountCancellation.outcome.code, "analysis_canceled");

  assert.ok(archiveCountCancellation.cancelMs < 1_000);

  console.log(
    `Archive worker cancellation ${archiveCountCancellation.cancelMs.toFixed(2)} ms`,
  );

  const embedded = JSON.parse(
    readFileSync("tests/fixtures/embedded.json", "utf8"),
  );

  const browserEmbedded = (await harness.evaluate(
    (fixture) =>
      new Promise<unknown>((resolve) =>
        chrome.runtime.sendMessage(
          { type: "counter.analyze", ...fixture },
          resolve,
        ),
      ),
    embedded,
  )) as { ok: boolean; result: { totals: { files: number; lines: number } } };

  assert.equal(browserEmbedded.ok, true);

  assert.equal(browserEmbedded.result.totals.files, 6);

  assert.equal(browserEmbedded.result.totals.lines, 19);

  const invalid = await harness.evaluate(
    () =>
      new Promise<unknown>((resolve) =>
        chrome.runtime.sendMessage(
          {
            type: "counter.analyze",
            rules: { repositoryId: "1", commitSha: "a".repeat(40) },
            files: [{ path: "../bad.rs", bytes: [120] }],
          },
          resolve,
        ),
      ),
  );

  assert.deepEqual(invalid, { ok: false, error: "invalid_input" });

  const feasibility = await harness.evaluate(async () => {
    const send = (type: string, extra: Record<string, unknown> = {}) => {
      const requestId = crypto.randomUUID();
      return {
        requestId,
        response: new Promise<Record<string, unknown>>((resolve) =>
          chrome.runtime.sendMessage(
            {
              protocolVersion: 1,
              type,
              requestId,
              navigationId: "fixture-nav",
              ...extra,
            },
            resolve,
          ),
        ),
      };
    };
    const input = {
      rules: { repositoryId: "1", commitSha: "a".repeat(40) },
      files: [
        {
          path: "fixture.rs",
          bytes: [...new TextEncoder().encode("fn main() {}\n")],
        },
      ],
    };
    const baselineAt = performance.now();
    const baseline = await send("feasibility.start", {
      input: { ...input, slowCall: true },
    }).response;
    const slowMs = performance.now() - baselineAt;
    const slow = send("feasibility.start", {
      input: { ...input, slowCall: true },
    });
    await new Promise<void>((resolve) => {
      const listener = (message: unknown) => {
        if (
          typeof message === "object" &&
          message !== null &&
          "type" in message &&
          message.type === "feasibility.counting" &&
          "requestId" in message &&
          message.requestId === slow.requestId
        ) {
          chrome.runtime.onMessage.removeListener(listener);
          resolve();
        }
      };
      chrome.runtime.onMessage.addListener(listener);
    });
    const cancelAt = performance.now();
    const canceled = await send("feasibility.cancel", {
      targetRequestId: slow.requestId,
    }).response;
    const cancelMs = performance.now() - cancelAt;
    const next = await send("feasibility.start", { input }).response;
    const delayed = send("feasibility.start", {
      input: { ...input, fixtureDelayMs: 800 },
    });
    await new Promise((resolve) => setTimeout(resolve, 100));
    const unrelatedCancel = await send("feasibility.cancel", {
      navigationId: "other-nav",
      targetRequestId: delayed.requestId,
    }).response;
    const canceledDelayed = await send("feasibility.cancel", {
      targetRequestId: delayed.requestId,
    }).response;
    const delayedOriginal = await delayed.response;
    const afterDelay = await send("feasibility.start", { input }).response;
    await new Promise((resolve) => setTimeout(resolve, 850));
    const statusAfterDelay = await send("feasibility.status").response;
    const unrelatedStatus = await send("feasibility.status", {
      navigationId: "other-nav",
    }).response;
    return {
      baseline,
      slowMs,
      canceled,
      cancelMs,
      next,
      canceledDelayed,
      unrelatedCancel,
      delayedOriginal,
      afterDelay,
      statusAfterDelay,
      unrelatedStatus,
    };
  });

  assert.equal(feasibility.baseline.state, "completed");

  assert.equal(feasibility.canceled.state, "canceled");

  assert.ok(
    feasibility.cancelMs < 1_000,
    `Cancellation took ${feasibility.cancelMs} ms`,
  );

  assert.equal(feasibility.next.state, "completed");

  assert.equal(feasibility.canceledDelayed.state, "canceled");

  assert.equal(feasibility.unrelatedCancel.state, "idle");

  assert.equal(feasibility.delayedOriginal.state, "canceled");

  assert.equal(feasibility.afterDelay.state, "completed");

  assert.equal(feasibility.statusAfterDelay.state, "completed");

  assert.equal(feasibility.unrelatedStatus.state, "idle");

  console.log(
    `Slow real counter call ${feasibility.slowMs.toFixed(2)} ms; cancellation ${feasibility.cancelMs.toFixed(2)} ms; next job completed`,
  );

  const cdp = await context.newCDPSession(harness);

  let versionId: string | undefined;

  cdp.on("ServiceWorker.workerVersionUpdated", (event) => {
    for (const version of event.versions) {
      if (version.scriptURL === worker.url() && version.status === "activated")
        versionId = version.versionId;
    }
  });

  await cdp.send("ServiceWorker.enable");

  await page.waitForFunction(() => true);

  assert.ok(versionId, "Chrome reported the active coordinator version");

  await harness.evaluate(async () => {
    const input = {
      rules: { repositoryId: "1", commitSha: "a".repeat(40) },
      files: [],
      slowCall: true,
      blockMs: 10_000,
    };
    const requestId = crypto.randomUUID();
    const counting = new Promise<void>((resolve) => {
      const listener = (message: unknown) => {
        if (
          typeof message === "object" &&
          message !== null &&
          "type" in message &&
          message.type === "feasibility.counting" &&
          "requestId" in message &&
          message.requestId === requestId
        ) {
          chrome.runtime.onMessage.removeListener(listener);
          resolve();
        }
      };
      chrome.runtime.onMessage.addListener(listener);
    });
    chrome.runtime.sendMessage(
      {
        protocolVersion: 1,
        type: "feasibility.start",
        requestId,
        navigationId: "restart-nav",
        input,
      },
      () => undefined,
    );
    await counting;
  });

  await harness.waitForFunction(async () =>
    Boolean(
      (await chrome.storage.session.get("feasibility.active"))[
        "feasibility.active"
      ],
    ),
  );

  await harness.waitForFunction(
    async () =>
      (
        await chrome.runtime.getContexts({
          contextTypes: ["OFFSCREEN_DOCUMENT"],
        })
      ).length > 0,
  );

  const probeHost = () =>
    harness.evaluate(
      () =>
        new Promise<boolean>((resolve) => {
          const channel = new BroadcastChannel("culverin-feasibility-probe");
          const id = crypto.randomUUID();
          channel.onmessage = (event: MessageEvent<unknown>) => {
            const value = event.data as {
              type?: unknown;
              id?: unknown;
              active?: unknown;
            };
            if (value?.type === "probe.reply" && value.id === id) {
              channel.close();
              resolve(value.active === true);
            }
          };
          channel.postMessage({ type: "probe", id });
        }),
    );

  assert.equal(await probeHost(), true);

  const acquisitionNavigationId = await settingsPage.evaluate(async () => {
    const contexts = await chrome.runtime.getContexts({
      contextTypes: ["TAB"],
      documentUrls: [location.href],
    });
    const documentId = contexts[0]?.documentId;
    if (!documentId) throw new Error("Settings document identity unavailable");
    const navigationId = crypto.randomUUID();
    await chrome.storage.session.set({
      "github.job": [
        {
          requestId: crypto.randomUUID(),
          owner: `o:${documentId}:${navigationId}`,
          public: false,
        },
      ],
    });
    return navigationId;
  });

  await cdp.send("ServiceWorker.stopWorker", { versionId });

  await new Promise((resolve) => setTimeout(resolve, 3_500));

  assert.equal(await probeHost(), false, "orphan lease terminated the worker");

  const acquisitionStatus = await settingsPage.evaluate(
    (navigationId) =>
      new Promise<Record<string, unknown>>((resolve) =>
        chrome.runtime.sendMessage(
          {
            protocolVersion: 1,
            type: "analysis.status",
            requestId: crypto.randomUUID(),
            navigationId,
          },
          resolve,
        ),
      ),
    acquisitionNavigationId,
  );

  assert.equal(acquisitionStatus.state, "interrupted");

  assert.deepEqual(
    await settingsPage.evaluate(() => chrome.storage.session.get("github.job")),
    {},
  );

  const recoveredStatus = await harness.evaluate(
    () =>
      new Promise<Record<string, unknown>>((resolve) =>
        chrome.runtime.sendMessage(
          {
            protocolVersion: 1,
            type: "feasibility.status",
            requestId: crypto.randomUUID(),
            navigationId: "restart-nav",
          },
          resolve,
        ),
      ),
  );

  assert.equal(recoveredStatus.state, "interrupted");

  assert.deepEqual(
    await harness.evaluate(() =>
      chrome.storage.session.get("feasibility.active"),
    ),
    {},
  );

  const afterRestart = await harness.evaluate(
    () =>
      new Promise<Record<string, unknown>>((resolve) =>
        chrome.runtime.sendMessage(
          {
            protocolVersion: 1,
            type: "feasibility.start",
            requestId: crypto.randomUUID(),
            navigationId: "restart-nav",
            input: {
              rules: { repositoryId: "1", commitSha: "a".repeat(40) },
              files: [
                {
                  path: "after.rs",
                  bytes: [102, 110, 32, 102, 40, 41, 32, 123, 125, 10],
                },
              ],
            },
          },
          resolve,
        ),
      ),
  );

  assert.equal(afterRestart.state, "completed");

  await harness.waitForFunction(
    async () =>
      (
        await chrome.runtime.getContexts({
          contextTypes: ["OFFSCREEN_DOCUMENT"],
        })
      ).length === 0,
  );

  await harness.evaluate(async (bytes) => {
    const requestId = crypto.randomUUID();
    const counting = new Promise<void>((resolve) => {
      const listener = (message: unknown) => {
        if (
          message &&
          typeof message === "object" &&
          "type" in message &&
          message.type === "archive.counting" &&
          "requestId" in message &&
          message.requestId === requestId
        ) {
          chrome.runtime.onMessage.removeListener(listener);
          resolve();
        }
      };
      chrome.runtime.onMessage.addListener(listener);
    });
    chrome.runtime.sendMessage(
      { type: "archive.fixture", requestId, bytes, countBlockMs: 10_000 },
      () => undefined,
    );
    await counting;
  }, largeArchive);

  assert.equal(await probeHost(), true);

  await cdp.send("ServiceWorker.stopWorker", { versionId });

  await new Promise((resolve) => setTimeout(resolve, 3_500));

  assert.equal(await probeHost(), false);

  const afterArchiveRestart = await harness.evaluate(
    (bytes) =>
      new Promise<Record<string, unknown>>((resolve) =>
        chrome.runtime.sendMessage(
          { type: "archive.fixture", requestId: crypto.randomUUID(), bytes },
          resolve,
        ),
      ),
    archiveFixture,
  );

  assert.equal(afterArchiveRestart.state, "analyzed");

  await cdp.detach();

  fixtures.mode = "ok";
  return { ...state, outcome };
}
