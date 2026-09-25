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
  "options.html",
  "options.js",
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
  [
    "culverin_counter_bg-HASH.wasm",
    "pending-HASH.js",
    "tar-HASH.js",
    "worker-HASH.js",
    "worker-HASH.js",
  ],
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
for (const file of ["options.js", "content.js", "offscreen.js"]) {
  assert.equal(
    readFileSync(resolve(directory, file), "utf8").includes("github.active"),
    false,
  );
}
for (const file of readdirSync(resolve(directory, "assets")).filter((name) =>
  name.endsWith(".js"),
)) {
  assert.equal(
    readFileSync(resolve(directory, "assets", file), "utf8").includes(
      "github.active",
    ),
    false,
  );
}
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
  const publicSha = "a".repeat(40);
  let fixtureArchiveRequests = 0;
  let fixtureApiRequests = 0;
  let fixtureMode: "ok" | "empty" | "rate" | "slow" | "shared" | "private" =
    "ok";
  let slowArchiveStarted: (() => void) | undefined;
  await context.route(
    "https://api.github.com/repos/culverin/bootstrap-fixture**",
    (route) => {
      const url = new URL(route.request().url());
      fixtureApiRequests++;
      if (fixtureMode === "rate")
        return route.fulfill({
          status: 403,
          headers: {
            "x-ratelimit-remaining": "0",
            "x-ratelimit-reset": String(Math.floor(Date.now() / 1000) + 3600),
          },
        });
      if (url.pathname.endsWith(`/commits/main`)) {
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ sha: publicSha }),
        });
      }
      if (url.pathname.endsWith(`/tarball/${publicSha}`)) {
        fixtureArchiveRequests++;
        if (fixtureMode === "slow" || fixtureMode === "shared") {
          slowArchiveStarted?.();
          return new Promise<void>((resolve) =>
            setTimeout(resolve, fixtureMode === "shared" ? 4000 : 1500),
          ).then(() => route.fulfill({ status: 404 }).catch(() => undefined));
        }
        return route.fulfill({ status: 404 });
      }
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          id: 1,
          name: "bootstrap-fixture",
          owner: { login: "culverin" },
          private: fixtureMode === "private",
          default_branch: fixtureMode === "empty" ? null : "main",
        }),
      });
    },
  );
  await context.route(
    "https://api.github.com/repos/culverin/bootstrap-other**",
    (route) => {
      const url = new URL(route.request().url());
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(
          url.pathname.endsWith("/commits/main")
            ? { sha: publicSha }
            : {
                id: 2,
                name: "bootstrap-other",
                owner: { login: "culverin" },
                private: false,
                default_branch: "main",
              },
        ),
      });
    },
  );
  await page.route("https://github.com/culverin/bootstrap-fixture", (route) =>
    route.fulfill({
      status: 200,
      contentType: "text/html",
      body: "<!doctype html><html><body><main id='repository-container-header'>Fixture</main></body></html>",
    }),
  );
  await page.goto("https://github.com/culverin/bootstrap-fixture#readme");
  await page.getByRole("button", { name: "Analyze repository" }).waitFor();
  assert.equal(await page.locator("[data-culverin-root]").count(), 1);
  await page.getByText(/Ready to analyze main at/).waitFor({ timeout: 15_000 });
  assert.equal(fixtureArchiveRequests, 0);
  assert.equal(
    await page
      .locator("[data-culverin-root]")
      .evaluate((host) =>
        Boolean(
          host.shadowRoot?.querySelector('[role="status"][aria-live="polite"]'),
        ),
      ),
    true,
  );
  await page.getByRole("button", { name: "Analyze repository" }).focus();
  assert.equal(
    await page
      .locator("[data-culverin-root]")
      .evaluate(
        (host) =>
          host.shadowRoot?.activeElement?.textContent === "Analyze repository",
      ),
    true,
  );
  await page.keyboard.press("Shift+Tab");
  await page.keyboard.press("Tab");
  assert.equal(
    await page
      .getByRole("button", { name: "Analyze repository" })
      .evaluate((button) => getComputedStyle(button).outlineStyle),
    "solid",
  );
  await page.evaluate(() => {
    document.documentElement.style.setProperty(
      "--fgColor-default",
      "rgb(255, 255, 255)",
    );
    document.documentElement.style.setProperty(
      "--bgColor-default",
      "rgb(0, 0, 0)",
    );
  });
  assert.deepEqual(
    await page.locator("[data-culverin-root]").evaluate((host) => {
      const card = host.shadowRoot!.querySelector(".card")!;
      const style = getComputedStyle(card);
      return [style.color, style.backgroundColor];
    }),
    ["rgb(255, 255, 255)", "rgb(0, 0, 0)"],
  );
  await page.evaluate(() => {
    document.documentElement.style.removeProperty("--fgColor-default");
    document.documentElement.style.removeProperty("--bgColor-default");
  });
  await page.emulateMedia({ colorScheme: "dark" });
  assert.deepEqual(
    await page.locator("[data-culverin-root]").evaluate((host) => {
      const style = getComputedStyle(host.shadowRoot!.querySelector(".card")!);
      return [style.color, style.backgroundColor];
    }),
    ["rgb(240, 246, 252)", "rgb(13, 17, 23)"],
  );
  await page.emulateMedia({ colorScheme: "light" });
  await page.emulateMedia({ forcedColors: "active" });
  assert.equal(
    await page
      .locator("[data-culverin-root]")
      .evaluate(
        (host) =>
          getComputedStyle(host.shadowRoot!.querySelector(".card")!)
            .borderStyle,
      ),
    "solid",
  );
  await page.emulateMedia({ forcedColors: "none" });
  const beforeFragmentApiRequests = fixtureApiRequests;
  await page.evaluate(() => {
    location.hash = "usage";
  });
  await page.waitForTimeout(150);
  assert.equal(await page.locator("[data-culverin-root]").count(), 1);
  assert.equal(fixtureApiRequests, beforeFragmentApiRequests);
  assert.equal(fixtureArchiveRequests, 0);
  await page.getByRole("button", { name: "Analyze repository" }).click();
  await page
    .getByText(/Repository unavailable or access is restricted/)
    .waitFor({ timeout: 15_000 });
  assert.equal(fixtureArchiveRequests, 1);
  await page.reload();
  await page.getByText(/Ready to analyze main at/).waitFor();
  assert.equal(fixtureArchiveRequests, 1);
  await page.evaluate(() => {
    history.pushState({}, "", "/culverin/bootstrap-fixture/issues");
  });
  await page.locator("[data-culverin-root]").waitFor({ state: "detached" });
  await page.evaluate(() => {
    history.replaceState({}, "", "/culverin/bootstrap-fixture");
  });
  await page.getByText(/Ready to analyze main at/).waitFor();
  assert.equal(await page.locator("[data-culverin-root]").count(), 1);
  assert.equal(fixtureArchiveRequests, 1);
  const originalRoot = await page
    .locator("[data-culverin-root]")
    .elementHandle();
  await page.evaluate(() => {
    history.pushState({}, "", "/culverin/bootstrap-other");
  });
  await page.waitForFunction((root) => !root.isConnected, originalRoot);
  await page.getByText(/Ready to analyze main at/).waitFor();
  assert.equal(await page.locator("[data-culverin-root]").count(), 1);
  assert.equal(fixtureArchiveRequests, 1);
  const otherRoot = await page.locator("[data-culverin-root]").elementHandle();
  await page.evaluate(() => {
    history.back();
  });
  await page.waitForFunction((root) => !root.isConnected, otherRoot);
  await page.getByText(/Ready to analyze main at/).waitFor();
  assert.equal(await page.locator("[data-culverin-root]").count(), 1);
  await page.evaluate(() => history.forward());
  await page.getByText(/Ready to analyze main at/).waitFor();
  assert.equal(await page.locator("[data-culverin-root]").count(), 1);
  await page.evaluate(() => history.back());
  await page.getByText(/Ready to analyze main at/).waitFor();
  assert.equal(await page.locator("[data-culverin-root]").count(), 1);
  await page.evaluate(() => {
    const marker = document.querySelector("#repository-container-header");
    if (!marker) throw new Error("Missing repository marker");
    const replacement = document.createElement("main");
    replacement.id = "repository-container-header";
    marker.replaceWith(replacement);
  });
  await page.getByRole("button", { name: "Analyze repository" }).waitFor();
  assert.equal(await page.locator("[data-culverin-root]").count(), 1);
  assert.equal(fixtureArchiveRequests, 1);
  fixtureMode = "slow";
  const started = new Promise<void>((resolve) => {
    slowArchiveStarted = resolve;
  });
  await page.getByText(/Ready to analyze main at/).waitFor();
  await page.getByRole("button", { name: "Analyze repository" }).click();
  await started;
  await page.evaluate(() => {
    location.hash = "readme";
  });
  await page.waitForTimeout(150);
  assert.equal(await page.locator("[data-culverin-root]").count(), 1);
  assert.equal(
    await page.getByRole("button", { name: "Cancel analysis" }).count(),
    1,
  );
  await page.getByRole("button", { name: "Cancel analysis" }).click();
  await page.getByText("Analysis canceled.").waitFor();
  await page.waitForTimeout(1700);
  assert.equal(await page.getByText(/code lines across/).count(), 0);
  const navigationArchive = new Promise<void>((resolve) => {
    slowArchiveStarted = resolve;
  });
  await page.getByRole("button", { name: "Analyze repository" }).click();
  await navigationArchive;
  await page.evaluate(() => {
    history.pushState({}, "", "/culverin/bootstrap-fixture/issues");
  });
  await page.locator("[data-culverin-root]").waitFor({ state: "detached" });
  fixtureMode = "ok";
  await page.evaluate(() => {
    history.replaceState({}, "", "/culverin/bootstrap-fixture");
  });
  await page.getByText(/Ready to analyze main at/).waitFor({ timeout: 1000 });
  await page.getByRole("button", { name: "Analyze repository" }).click();
  await page
    .getByText(/Repository unavailable or access is restricted/)
    .waitFor();
  assert.equal(fixtureArchiveRequests, 4);
  const clearPublicCache = async () => {
    const worker =
      context.serviceWorkers()[0] ??
      (await context.waitForEvent("serviceworker"));
    const control = await context.newPage();
    await control.goto(
      `chrome-extension://${new URL(worker.url()).host}/options.html`,
    );
    const state = await control.evaluate(
      () =>
        new Promise<{ state: string }>((resolve) =>
          chrome.runtime.sendMessage(
            {
              protocolVersion: 1,
              type: "cache.clear-public",
              requestId: crypto.randomUUID(),
              navigationId: crypto.randomUUID(),
            },
            resolve,
          ),
        ),
    );
    assert.equal(state.state, "public-cache-cleared");
    await control.close();
  };
  fixtureMode = "empty";
  await clearPublicCache();
  await page.reload();
  await page
    .getByText("This repository has no default-branch commit to analyze.")
    .waitFor();
  fixtureMode = "private";
  await clearPublicCache();
  await page.reload();
  await page
    .getByText(/Repository unavailable or access is restricted/)
    .waitFor();
  assert.equal(fixtureArchiveRequests, 4);
  fixtureMode = "ok";
  await page.route("https://github.com/settings/profile", (route) =>
    route.fulfill({
      status: 200,
      contentType: "text/html",
      body: "<!doctype html><html><body><main>Settings</main></body></html>",
    }),
  );
  await page.goto("https://github.com/settings/profile");
  assert.equal(await page.locator("[data-culverin-root]").count(), 0);
  const worker =
    context.serviceWorkers()[0] ??
    (await context.waitForEvent("serviceworker"));
  const harness = await context.newPage();
  await harness.goto(
    `chrome-extension://${new URL(worker.url()).host}/test-harness.html`,
  );
  const options = await context.newPage();
  await options.goto(
    `chrome-extension://${new URL(worker.url()).host}/options.html`,
  );
  await options.getByText("No token connected.").waitFor();
  await options.locator("details summary").click();
  await options.getByRole("button", { name: "Clear public cache" }).click();
  await options.getByText("Public cache cleared.").waitFor();
  const publicFixtureBytes = [
    ...readFileSync("tests/fixtures/archive-source.tar.gz"),
  ];
  await worker.evaluate(
    ({ bytes, sha }) => {
      const scope = globalThis as typeof globalThis & {
        fixtureOriginalFetch?: typeof fetch;
        fixtureFetchCount?: number;
      };
      scope.fixtureOriginalFetch = fetch;
      scope.fixtureFetchCount = 0;
      globalThis.fetch = (async (input, init) => {
        if (String(input).endsWith(`/tarball/${sha}`)) {
          scope.fixtureFetchCount = (scope.fixtureFetchCount ?? 0) + 1;
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
  await page.getByText(/Ready to analyze main at/).waitFor();
  assert.equal(
    await worker.evaluate(
      () =>
        (globalThis as typeof globalThis & { fixtureFetchCount?: number })
          .fixtureFetchCount,
    ),
    0,
  );
  await page.getByRole("button", { name: "Analyze repository" }).click();
  await page.getByText("Analyzed locally.").waitFor({ timeout: 15_000 });
  await page.getByText("1 code lines across 1 files").waitFor();
  await page
    .getByText(
      /Source profile coverage: 1 of 2 regular files counted; 1 skipped/,
    )
    .waitFor();
  const disclosure = page.locator("[data-culverin-root] details");
  await disclosure.locator("summary").focus();
  await page.keyboard.press("Enter");
  assert.equal(
    await disclosure.evaluate(
      (element) => (element as HTMLDetailsElement).open,
    ),
    false,
  );
  await page.keyboard.press("Enter");
  assert.equal(
    await disclosure.evaluate(
      (element) => (element as HTMLDetailsElement).open,
    ),
    true,
  );
  assert.equal(
    await page
      .locator("[data-culverin-root]")
      .evaluate(
        (host) =>
          host.shadowRoot?.querySelector('[role="status"]')?.textContent,
      ),
    "Analyzed locally.",
  );
  const accessibility = await context.newCDPSession(page);
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
  await page.getByText(new RegExp(publicSha.slice(0, 12))).waitFor();
  assert.equal(
    await worker.evaluate(
      () =>
        (globalThis as typeof globalThis & { fixtureFetchCount?: number })
          .fixtureFetchCount,
    ),
    1,
  );
  await page.reload();
  await page.getByText(/Cached local analysis/).waitFor();
  assert.equal(
    await worker.evaluate(
      () =>
        (globalThis as typeof globalThis & { fixtureFetchCount?: number })
          .fixtureFetchCount,
    ),
    1,
  );
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
  const optionsState = await options.evaluate(async () => {
    const send = (type: string) =>
      new Promise<{ state: string; connected?: boolean }>((resolve) =>
        chrome.runtime.sendMessage(
          {
            protocolVersion: 1,
            type,
            requestId: crypto.randomUUID(),
            navigationId: crypto.randomUUID(),
          },
          resolve,
        ),
      );
    const initial = await send("auth.status");
    const idle = await send("analysis.status");
    const cleared = await send("auth.clear-private-session");
    const disconnected = await send("auth.disconnect");
    const after = await send("auth.status");
    return {
      initial,
      idle,
      cleared,
      disconnected,
      after,
      storage: await chrome.storage.session.get([
        "github.active",
        "github.pending",
      ]),
    };
  });
  assert.equal(optionsState.initial.connected, false);
  assert.equal(optionsState.idle.state, "idle");
  assert.equal(optionsState.cleared.state, "cleared");
  assert.equal(optionsState.disconnected.state, "disconnected");
  assert.equal(optionsState.after.connected, false);
  assert.deepEqual(optionsState.storage, {});
  const rejectedPublicFromOptions = await options.evaluate(
    () =>
      new Promise<Record<string, unknown>>((resolve) =>
        chrome.runtime.sendMessage(
          {
            protocolVersion: 1,
            type: "analysis.request",
            requestId: crypto.randomUUID(),
            navigationId: crypto.randomUUID(),
            repository: { owner: "culverin", name: "bootstrap-fixture" },
          },
          resolve,
        ),
      ),
  );
  assert.deepEqual(
    {
      state: rejectedPublicFromOptions.state,
      code: rejectedPublicFromOptions.code,
    },
    { state: "failed", code: "invalid_repository" },
  );
  assert.equal(fixtureArchiveRequests, 4);
  const interruptionCdp = await context.newCDPSession(harness);
  let interruptedVersion: string | undefined;
  interruptionCdp.on("ServiceWorker.workerVersionUpdated", (event) => {
    for (const version of event.versions)
      if (version.status === "activated")
        interruptedVersion = version.versionId;
  });
  await interruptionCdp.send("ServiceWorker.enable");
  await page.goto("https://github.com/culverin/bootstrap-fixture");
  await page.getByText(/Cached local analysis/).waitFor();
  assert.equal(fixtureArchiveRequests, 4);
  fixtureMode = "private";
  const privateObservation = await options.evaluate(
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
  const afterPrivate = await options.evaluate(async () => {
    const state = await chrome.storage.local.get("culverin.public-results.v1");
    return (state["culverin.public-results.v1"] as { entries: unknown[] })
      .entries.length;
  });
  assert.equal(afterPrivate, 0);
  fixtureMode = "ok";
  await clearPublicCache();
  const partialBytes = [
    ...readFileSync("tests/fixtures/archive-partial.tar.gz"),
  ];
  await worker.evaluate(
    ({ bytes, sha }) => {
      const scope = globalThis as typeof globalThis & {
        partialOriginalFetch?: typeof fetch;
      };
      scope.partialOriginalFetch = fetch;
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
        return scope.partialOriginalFetch!(input, init);
      }) as typeof fetch;
    },
    { bytes: partialBytes, sha: publicSha },
  );
  await page.reload();
  await page.getByText(/Ready to analyze main at/).waitFor();
  await page.getByRole("button", { name: "Analyze repository" }).click();
  await page.getByText("Partial local analysis.").waitFor({ timeout: 15_000 });
  const persistedPartial = await options.evaluate(async () => {
    const state = await chrome.storage.local.get("culverin.public-results.v1");
    return (state["culverin.public-results.v1"] as { entries: unknown[] })
      .entries.length;
  });
  assert.equal(persistedPartial, 0);
  await worker.evaluate(() => {
    const scope = globalThis as typeof globalThis & {
      partialOriginalFetch?: typeof fetch;
    };
    if (scope.partialOriginalFetch)
      globalThis.fetch = scope.partialOriginalFetch;
    delete scope.partialOriginalFetch;
  });
  await clearPublicCache();
  await page.reload();
  await page.getByText(/Ready to analyze main at/).waitFor();
  fixtureMode = "slow";
  const interruptedArchive = new Promise<void>((resolve) => {
    slowArchiveStarted = resolve;
  });
  await page.getByRole("button", { name: "Analyze repository" }).click();
  await interruptedArchive;
  const competing = await options.evaluate(async () => {
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
  assert.ok(interruptedVersion);
  await interruptionCdp.send("ServiceWorker.stopWorker", {
    versionId: interruptedVersion,
  });
  await page.getByText(/Analysis was interrupted/).waitFor({ timeout: 15_000 });
  await page.waitForTimeout(1700);
  assert.equal(fixtureArchiveRequests, 5);
  fixtureMode = "ok";
  await page.getByRole("button", { name: "Analyze repository" }).click();
  await page
    .getByText(/Repository unavailable or access is restricted/)
    .waitFor({ timeout: 15_000 });
  assert.equal(fixtureArchiveRequests, 6);
  await interruptionCdp.detach();
  fixtureMode = "shared";
  await page.reload();
  await page.getByText(/Ready to analyze main at/).waitFor();
  const sharedStarted = new Promise<void>((resolve) => {
    slowArchiveStarted = resolve;
  });
  await page.getByRole("button", { name: "Analyze repository" }).click();
  await sharedStarted;
  const second = await context.newPage();
  await second.route("https://github.com/culverin/bootstrap-fixture", (route) =>
    route.fulfill({
      status: 200,
      contentType: "text/html",
      body: "<!doctype html><html><body><main id='repository-container-header'>Fixture</main></body></html>",
    }),
  );
  await second.goto("https://github.com/culverin/bootstrap-fixture");
  await second.getByText(/Ready to analyze main at/).waitFor();
  await second.getByRole("button", { name: "Analyze repository" }).click();
  const sharedMarkers = await options.evaluate(async () => {
    for (let attempt = 0; attempt < 100; attempt++) {
      const state = await chrome.storage.session.get("github.job");
      const markers = state["github.job"] as
        { requestId: string }[] | undefined;
      if (markers?.length === 2) return markers;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    throw new Error("Shared subscribers did not appear");
  });
  const crossTab = await context.newCDPSession(page);
  const crossContexts: { id: number; origin: string }[] = [];
  crossTab.on("Runtime.executionContextCreated", ({ context }) => {
    if (context.auxData?.type === "isolated")
      crossContexts.push({ id: context.id, origin: context.origin });
  });
  await crossTab.send("Runtime.enable");
  const firstContext = crossContexts.find((item) =>
    item.origin.startsWith("chrome-extension://"),
  );
  assert.ok(firstContext);
  const rejectedCrossTab = await crossTab.send("Runtime.evaluate", {
    contextId: firstContext.id,
    expression: `new Promise(resolve => chrome.runtime.sendMessage({protocolVersion:1,type:"analysis.cancel",requestId:crypto.randomUUID(),navigationId:crypto.randomUUID(),targetRequestId:"${sharedMarkers[1]!.requestId}"},resolve))`,
    awaitPromise: true,
    returnByValue: true,
  });
  assert.equal(rejectedCrossTab.result.value.code, "analysis_interrupted");
  await crossTab.detach();
  await page.getByRole("button", { name: "Cancel analysis" }).click();
  await page.getByText("Analysis canceled.").waitFor();
  await second
    .getByText(/Repository unavailable or access is restricted/)
    .waitFor({ timeout: 15_000 });
  assert.equal(fixtureArchiveRequests, 7);
  await second.close();
  fixtureMode = "ok";
  if (process.env.CULVERIN_LIVE_PUBLIC === "1") {
    const networkOrigins = new Set<string>();
    const requests: {
      origin: string;
      authorization: boolean;
      cookie: boolean;
    }[] = [];
    context.on("request", (request) => {
      if (!request.serviceWorker()) return;
      const origin = new URL(request.url()).origin;
      if (origin.startsWith("https://")) networkOrigins.add(origin);
      if (
        origin === "https://api.github.com" ||
        origin === "https://codeload.github.com"
      ) {
        const headers = request.headers();
        requests.push({
          origin,
          authorization: Boolean(headers.authorization),
          cookie: Boolean(headers.cookie),
        });
      }
    });
    const livePage = await context.newPage();
    await livePage.goto("https://github.com/octocat/Hello-World", {
      waitUntil: "commit",
      timeout: 60_000,
    });
    await livePage
      .getByRole("button", { name: "Analyze repository" })
      .waitFor({ timeout: 30_000 });
    await livePage.getByText(/Ready to analyze/).waitFor({ timeout: 30_000 });
    const beforeClick = requests.filter(
      (request) => request.origin === "https://codeload.github.com",
    ).length;
    await livePage.reload({ waitUntil: "commit", timeout: 60_000 });
    await livePage.getByText(/Ready to analyze/).waitFor({ timeout: 30_000 });
    assert.equal(
      requests.filter(
        (request) => request.origin === "https://codeload.github.com",
      ).length,
      beforeClick,
    );
    await livePage.getByRole("button", { name: "Analyze repository" }).click();
    await livePage
      .getByText(/Analyzed locally.|Partial local analysis./)
      .waitFor({ timeout: 30_000 });
    assert.equal(
      requests.filter(
        (request) => request.origin === "https://codeload.github.com",
      ).length,
      beforeClick + 1,
    );
    await livePage.close();
    const beforeOptionsLookup = requests.filter(
      (request) => request.origin === "https://codeload.github.com",
    ).length;
    await options.locator("#owner").fill("octocat");
    await options.locator("#name").fill("Hello-World");
    await options.locator("#lookup").click();
    await options
      .getByText(/public default branch/)
      .waitFor({ timeout: 30_000 });
    assert.equal(
      requests.filter(
        (request) => request.origin === "https://codeload.github.com",
      ).length,
      beforeOptionsLookup,
    );
    await options.locator("#download").click();
    await options.getByText(/Analyzed .* files/).waitFor({ timeout: 30_000 });
    assert.equal(
      requests.filter(
        (request) => request.origin === "https://codeload.github.com",
      ).length,
      beforeOptionsLookup + 1,
    );
    assert.ok(
      requests.some((request) => request.origin === "https://api.github.com"),
    );
    assert.ok(
      requests.some(
        (request) => request.origin === "https://codeload.github.com",
      ),
    );
    assert.ok(
      requests.every((request) => !request.authorization && !request.cookie),
    );
    assert.ok(
      [...networkOrigins].every((origin) =>
        [
          "https://api.github.com",
          "https://codeload.github.com",
          "https://github.com",
        ].includes(origin),
      ),
    );
    console.log(`Live public acquisition passed: ${JSON.stringify(requests)}`);
  }
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
    coverage: {
      regularFiles: number;
      skippedByReason: { unsupported_language: number };
      complete: boolean;
    };
  };
  assert.equal(archivedResult.totals.files, 1);
  assert.equal(archivedResult.totals.lines, 1);
  assert.equal(archivedResult.totals.code, 1);
  assert.equal(archivedResult.coverage.regularFiles, 2);
  assert.equal(archivedResult.coverage.skippedByReason.unsupported_language, 1);
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
  const acquisitionNavigationId = await options.evaluate(async () => {
    const contexts = await chrome.runtime.getContexts({
      contextTypes: ["TAB"],
      documentUrls: [location.href],
    });
    const documentId = contexts[0]?.documentId;
    if (!documentId) throw new Error("Options document identity unavailable");
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
  const acquisitionStatus = await options.evaluate(
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
    await options.evaluate(() => chrome.storage.session.get("github.job")),
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
  fixtureMode = "ok";
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
  await page.getByText(/Ready to analyze main at/).waitFor();
  await page.getByRole("button", { name: "Analyze repository" }).click();
  await page.getByText("0 code lines across 1 files").waitFor();
  await page.getByText(/No code lines were counted/).waitFor();
  assert.equal(await page.getByText(/NaN|Infinity/).count(), 0);
  await page.evaluate(() =>
    history.pushState({}, "", "/culverin/bootstrap-fixture"),
  );
  fixtureMode = "rate";
  await clearPublicCache();
  await page.reload();
  await page.getByText(/GitHub rate limit reached. Retry after/).waitFor();
  const limitedRequests = fixtureApiRequests;
  await page.reload();
  await page.getByText(/GitHub rate limit reached. Retry after/).waitFor();
  assert.equal(fixtureApiRequests, limitedRequests);
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
