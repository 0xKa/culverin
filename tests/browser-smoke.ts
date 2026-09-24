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
]);
assert.deepEqual(readdirSync(resolve(directory, "icons")).sort(), [
  "icon-128.png",
  "icon-16.png",
  "icon-32.png",
  "icon-48.png",
]);
assert.match(
  readdirSync(resolve(directory, "assets")).join(","),
  /^culverin_counter_bg-[^,]+\.wasm$/,
);
const manifest = JSON.parse(
  readFileSync(resolve(directory, "manifest.json"), "utf8"),
) as {
  permissions: string[];
  host_permissions: string[];
  content_security_policy: { extension_pages: string };
};
assert.deepEqual(manifest.permissions, ["storage"]);
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
