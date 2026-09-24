import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
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
const context = await chromium.launchPersistentContext(profile, {
  executablePath: process.env.CHROME_BIN || chromium.executablePath(),
  headless: true,
  args: [
    `--disable-extensions-except=${directory}`,
    `--load-extension=${directory}`,
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
  console.log(
    "Browser smoke passed: MV3 content script and packaged WASM loaded under CSP",
  );
} finally {
  await context.close();
  rmSync(profile, { recursive: true, force: true });
}
