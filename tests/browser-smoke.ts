import assert from "node:assert/strict";
import {
  cpSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { chromium } from "playwright";

const directory = resolve("extension/dist");
assert.deepEqual(readdirSync(directory).sort(), [
  "assets",
  "background.js",
  "content.js",
  "icons",
  "manifest.json",
  "offscreen.html",
  "offscreen.js",
]);
assert.deepEqual(readdirSync(resolve(directory, "icons")).sort(), [
  "icon-128.png",
  "icon-16.png",
  "icon-32.png",
  "icon-48.png",
]);
assert.deepEqual(
  readdirSync(resolve(directory, "assets"))
    .map((name) => name.replace(/-[A-Za-z0-9_-]+(?=\.)/, "-HASH"))
    .sort(),
  ["culverin_counter_bg-HASH.wasm", "protocol-HASH.js", "worker-HASH.js"],
);
const manifest = JSON.parse(
  readFileSync(resolve(directory, "manifest.json"), "utf8"),
) as {
  permissions: string[];
  host_permissions: string[];
  content_security_policy: { extension_pages: string };
};
assert.deepEqual(manifest.permissions, ["storage", "offscreen"]);
assert.deepEqual(manifest.host_permissions, [
  "https://github.com/*",
  "https://api.github.com/*",
  "https://codeload.github.com/*",
]);
assert.equal(
  manifest.content_security_policy.extension_pages,
  "script-src 'self' 'wasm-unsafe-eval'; object-src 'self'; connect-src 'self' https://api.github.com https://codeload.github.com https://github.com",
);
const profile = mkdtempSync(resolve(tmpdir(), "culverin-browser-"));
const packageCopy = resolve(profile, "extension");
cpSync(directory, packageCopy, { recursive: true });
writeFileSync(
  resolve(packageCopy, "test-harness.html"),
  "<!doctype html><title>Counter test</title>",
);
const context = await chromium.launchPersistentContext(profile, {
  executablePath: process.env.CHROME_BIN || chromium.executablePath(),
  headless: true,
  args: [
    "--headless=new",
    `--disable-extensions-except=${packageCopy}`,
    `--load-extension=${packageCopy}`,
  ],
});

try {
  const page = await context.newPage();
  await page.route("https://github.com/culverin/bootstrap-fixture", (route) =>
    route.fulfill({
      status: 200,
      contentType: "text/html",
      body: "<!doctype html><html><body>Fixture</body></html>",
    }),
  );
  await page.goto("https://github.com/culverin/bootstrap-fixture");
  await page.waitForFunction(
    () => document.documentElement.dataset.culverinBootstrap === "loaded",
  );
  const worker =
    context.serviceWorkers()[0] ??
    (await context.waitForEvent("serviceworker"));
  const harness = await context.newPage();
  await harness.goto(
    `chrome-extension://${new URL(worker.url()).host}/test-harness.html`,
  );
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
  assert.equal(browserEmbedded.result.totals.files, 5);
  assert.equal(browserEmbedded.result.totals.lines, 13);
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
  await cdp.send("ServiceWorker.stopWorker", { versionId });
  await new Promise((resolve) => setTimeout(resolve, 3_500));
  assert.equal(await probeHost(), false, "orphan lease terminated the worker");
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
  await cdp.detach();
  console.log(
    `Browser count ${outcome.countMs.toFixed(2)} ms, JS heap ${outcome.memory ?? "unavailable"} bytes`,
  );
  console.log(
    "Browser smoke passed: packaged WASM counted under CSP and recovered after trap",
  );
} finally {
  await context.close();
  rmSync(profile, { recursive: true, force: true });
}
