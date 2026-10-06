import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { gzipSync } from "node:zlib";
import type { Page } from "playwright";
import { archive, encoder, entry } from "../tar-fixture";
import { createPopupControls } from "./support/action-popup";
import { installGitHubFixtures } from "./support/fixtures";
import { closeBrowserSession, createBrowserSession } from "./support/session";

const label = process.argv[2] ?? "current";
const output = resolve(".bun/screenshots", label);
mkdirSync(output, { recursive: true });

const lines = (count: number, line: (index: number) => string) =>
  encoder.encode(
    Array.from({ length: count }, (_, index) => line(index)).join("\n") + "\n",
  );

const sources: [string, number, (index: number) => string][] = [
  ["src/app.ts", 1840, (i) => `export const value${i} = ${i};`],
  ["src/view.tsx", 920, (i) => `export const View${i} = () => ${i};`],
  ["counter/src/lib.rs", 1310, (i) => `pub const VALUE_${i}: u32 = ${i};`],
  ["scripts/build.py", 410, (i) => `value_${i} = ${i}`],
  ["tools/main.go", 260, (i) => `var value${i} = ${i}`],
  ["styles/site.css", 330, (i) => `.item-${i} { order: ${i}; }`],
  ["public/index.html", 140, (i) => `<p id="p${i}">${i}</p>`],
  ["config/settings.json", 90, (i) => (i === 0 ? "{" : `"k${i}": ${i},`)],
  ["config/ci.yml", 120, (i) => `key_${i}: ${i}`],
  ["scripts/setup.sh", 75, (i) => `VALUE_${i}=${i}`],
  ["Cargo.toml", 40, (i) => `key_${i} = ${i}`],
  ["native/shim.c", 60, (i) => `int value_${i} = ${i};`],
  ["db/schema.sql", 35, (i) => `SELECT ${i};`],
  ["README.md", 220, (i) => `Documentation line ${i}.`],
  ["docs/guide.md", 480, (i) => `Guide line ${i}.`],
  ["NOTES.txt", 60, (i) => `Note ${i}`],
  ["data/sample.csv", 300, (i) => `${i},${i * 2}`],
  ["assets/logo.svg", 12, (i) => `<g id="g${i}"/>`],
];

const fullArchive = gzipSync(
  archive(
    ...sources.map(([path, count, line]) =>
      entry(`fixture-abc123/${path}`, lines(count, line)),
    ),
  ),
);

const partialArchive = gzipSync(
  archive(
    ...sources
      .slice(0, 6)
      .map(([path, count, line]) =>
        entry(`fixture-abc123/${path}`, lines(count, line)),
      ),
    entry(
      "fixture-abc123/vendor/generated/bundle.rs",
      new Uint8Array(9 * 1024 * 1024).fill(120),
    ),
    entry(
      "fixture-abc123/src/too-large.rs",
      new Uint8Array(8 * 1024 * 1024 + 1).fill(120),
    ),
  ),
);

const schemes = ["light", "dark"] as const;

async function shoot(page: Page, name: string, fullPage = true) {
  for (const colorScheme of schemes) {
    await page.emulateMedia({ colorScheme, forcedColors: "none" });
    await page.waitForTimeout(150);
    await page.screenshot({
      path: resolve(output, `${name}-${colorScheme}.png`),
      fullPage,
    });
  }
  await page.emulateMedia({ colorScheme: "light" });
}

const session = await createBrowserSession(resolve("extension/dist"));
try {
  const { context } = session;
  const page = await context.newPage();
  await page.setViewportSize({ width: 1100, height: 700 });
  const fixtures = await installGitHubFixtures(context, page, "a".repeat(40));
  await page.goto("https://github.com/culverin/bootstrap-fixture");
  await page.getByText("Count lines of code").waitFor();

  const worker =
    context.serviceWorkers()[0] ??
    (await context.waitForEvent("serviceworker"));
  await worker.evaluate(
    ({ full, partial }) => {
      const scope = globalThis as typeof globalThis & {
        screenshotArchive?: number[];
        screenshotGate?: Promise<void>;
        screenshotArchives?: Record<string, number[]>;
      };
      scope.screenshotArchives = { full, partial };
      scope.screenshotArchive = full;
      const original = fetch;
      globalThis.fetch = (async (input, init) => {
        const url = String(input);
        if (url.includes("/tarball/")) {
          await scope.screenshotGate;
          const response = new Response(
            Uint8Array.from(scope.screenshotArchive ?? []),
            { status: 200, headers: { "content-type": "application/gzip" } },
          );
          Object.defineProperty(response, "url", {
            value: `https://codeload.github.com/culverin/bootstrap-fixture/legacy.tar.gz/${url.split("/").pop()}`,
          });
          return response;
        }
        return original(input, init);
      }) as typeof fetch;
    },
    { full: [...fullArchive], partial: [...partialArchive] },
  );

  const harness = await context.newPage();
  await harness.goto(
    `chrome-extension://${new URL(worker.url()).host}/test-harness.html`,
  );
  const { openPopup, extensionUrl } = createPopupControls(
    context,
    harness,
    worker.url(),
  );

  await shoot(page, "page-row-idle", false);

  const popup = await openPopup(page);
  await popup.setViewportSize({ width: 360, height: 560 });
  await shoot(popup, "popup-ready");

  await worker.evaluate(() => {
    const scope = globalThis as typeof globalThis & {
      screenshotGate?: Promise<void>;
      screenshotRelease?: () => void;
    };
    scope.screenshotGate = new Promise<void>((release) => {
      scope.screenshotRelease = release;
    });
  });
  await popup.getByRole("button", { name: "Analyze repository" }).click();
  await popup.locator("#cancel").waitFor({ state: "visible" });
  await shoot(popup, "popup-running");
  await worker.evaluate(() => {
    const scope = globalThis as typeof globalThis & {
      screenshotGate?: Promise<void>;
      screenshotRelease?: () => void;
    };
    scope.screenshotRelease?.();
    scope.screenshotGate = undefined;
  });

  await popup.getByRole("button", { name: "Reanalyze" }).waitFor();
  await popup.waitForTimeout(400);
  await shoot(popup, "popup-result");
  await popup.emulateMedia({ forcedColors: "active" });
  await popup.screenshot({
    path: resolve(output, "popup-result-forced-colors.png"),
    fullPage: true,
  });
  await popup.emulateMedia({ forcedColors: "none" });
  await popup.locator("#details > summary").click();
  await popup.waitForTimeout(400);
  await shoot(popup, "popup-collapsed");

  await page.bringToFront();
  await page.waitForTimeout(300);
  await shoot(page, "page-row-result", false);

  fixtures.sha = "b".repeat(40);
  await worker.evaluate(() => {
    const scope = globalThis as typeof globalThis & {
      screenshotArchive?: number[];
      screenshotArchives?: Record<string, number[]>;
    };
    scope.screenshotArchive = scope.screenshotArchives?.partial;
  });
  await page.reload();
  await page.locator("[data-culverin-root]").waitFor();
  const partialPopup = await openPopup(page);
  await partialPopup.setViewportSize({ width: 360, height: 560 });
  await partialPopup
    .getByRole("button", { name: /Analyze repository|Reanalyze/ })
    .click();
  await partialPopup
    .getByText(/too large to count/)
    .first()
    .waitFor();
  await partialPopup.waitForTimeout(400);
  await shoot(partialPopup, "popup-partial");

  const settings = await context.newPage();
  await settings.setViewportSize({ width: 1100, height: 800 });
  for (const section of ["storage", "ignore", "counting", "github", "about"]) {
    await settings.goto(`${extensionUrl}/settings.html#${section}`);
    await settings.reload();
    await settings.waitForTimeout(400);
    await shoot(settings, `settings-${section}`);
  }
  await settings.setViewportSize({ width: 600, height: 800 });
  await settings.goto(`${extensionUrl}/settings.html#storage`);
  await settings.reload();
  await settings.waitForTimeout(400);
  await shoot(settings, "settings-storage-narrow");
  await settings.goto(`${extensionUrl}/settings.html#github`);
  await settings.reload();
  await settings.waitForTimeout(400);
  await shoot(settings, "settings-github-narrow");
  await context.route("https://github.com/login/device/code", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        device_code: "screenshot-device",
        user_code: "ABCD-1234",
        verification_uri: "https://github.com/login/device",
        expires_in: 900,
        interval: 60,
      }),
    }),
  );
  await context.route("https://github.com/login/oauth/access_token", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ error: "authorization_pending" }),
    }),
  );
  await settings.setViewportSize({ width: 1100, height: 800 });
  await settings.goto(`${extensionUrl}/settings.html#github`);
  await settings.reload();
  await settings.locator("#github-connect").click();
  await settings.locator("#github-device-copy").click();
  await settings.locator("#github-copy-status").getByText(/./).waitFor();
  await shoot(settings, "settings-github-device");
  await settings.locator("#github-device-cancel").click();
  await settings.locator("#github-connect").waitFor();
  await settings.setViewportSize({ width: 1100, height: 800 });
  await worker.evaluate(() =>
    chrome.storage.session.remove("github.rateLimit"),
  );
  await settings.goto(`${extensionUrl}/settings.html#counting`);
  await settings.reload();
  await settings.waitForTimeout(400);
  await shoot(settings, "settings-counting-unknown");

  console.log(`Screenshots written to ${output}`);
} finally {
  await closeBrowserSession(session);
}
