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

const directory = resolve(
  process.env.CULVERIN_EXTENSION_DIR ?? "extension/dist",
);
assert.deepEqual(readdirSync(directory).sort(), [
  "THIRD_PARTY_NOTICES.txt",
  "assets",
  "background.js",
  "content.js",
  "icons",
  "manifest.json",
  "offscreen.html",
  "offscreen.js",
  "options.html",
  "options.js",
  "popup.html",
  "popup.js",
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
    "result-HASH.js",
    "settings-HASH.js",
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
  action: {
    default_icon: Record<string, string>;
    default_popup: string;
    default_title: string;
  };
  content_security_policy: { extension_pages: string };
};
assert.deepEqual(manifest.permissions, ["storage", "offscreen"]);
assert.deepEqual(manifest.action, {
  default_icon: {
    "16": "icons/icon-16.png",
    "32": "icons/icon-32.png",
    "48": "icons/icon-48.png",
    "128": "icons/icon-128.png",
  },
  default_title: "Culverin",
  default_popup: "popup.html",
});
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
  const repositoryFixture = `<!doctype html><html><head><meta name="octolytics-dimension-repository_nwo" content="culverin/bootstrap-fixture"><style>@media (max-width: 767px) { #about { display: none } }</style></head><body><main><react-app id="app"><div id="about"><h2>About</h2><div class="mt-2"><span>1 star</span></div><div class="mt-2"><a id="forks" href="/culverin/bootstrap-fixture/forks"><strong>0</strong> forks</a></div><div class="mt-2"><a href="/contact/report-content">Report repository</a></div></div></react-app></main><script>
const sync = () => {
  const [, owner, name] = location.pathname.split("/");
  document.querySelector("#forks").setAttribute("href", "/" + owner + "/" + name + "/forks");
  document.querySelector('meta[name="octolytics-dimension-repository_nwo"]').setAttribute("content", owner + "/" + name);
};
if (sessionStorage.getItem("holdHydration") !== "1")
  document.querySelector("#app").classList.add("loaded");
for (const method of ["pushState", "replaceState"]) {
  const original = history[method].bind(history);
  history[method] = (...args) => {
    original(...args);
    sync();
  };
}
addEventListener("popstate", sync);
sync();
</script></body></html>`;
  const summary = page.locator("[data-culverin-root]");
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
            setTimeout(resolve, fixtureMode === "shared" ? 4000 : 6000),
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
          size: 2048,
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
      body: repositoryFixture,
    }),
  );
  await page.goto("https://github.com/culverin/bootstrap-fixture#readme");
  await page.getByText("Count lines of code").waitFor();
  assert.equal(await summary.count(), 1);
  assert.deepEqual(
    await summary.evaluate((host) => ({
      after: host.previousElementSibling?.querySelector("a")?.id,
      before: host.nextElementSibling?.textContent,
      live: host.shadowRoot?.querySelector('[aria-live="polite"]')?.textContent,
      icon: host.shadowRoot?.querySelector("svg")?.getAttribute("fill"),
      shapes: host.shadowRoot?.querySelectorAll("svg rect").length,
    })),
    {
      after: "forks",
      before: "Report repository",
      live: "Count lines of code",
      icon: "currentColor",
      shapes: 7,
    },
  );
  assert.equal(
    await page.getByRole("button", { name: "Analyze repository" }).count(),
    0,
  );
  assert.equal(fixtureArchiveRequests, 0);
  const worker =
    context.serviceWorkers()[0] ??
    (await context.waitForEvent("serviceworker"));
  const harness = await context.newPage();
  await harness.goto(
    `chrome-extension://${new URL(worker.url()).host}/test-harness.html`,
  );
  const beforeWorkerStopApiRequests = fixtureApiRequests;
  const workerControl = await context.newCDPSession(page);
  await workerControl.send("ServiceWorker.enable");
  await workerControl.send("ServiceWorker.stopAllWorkers");
  await workerControl.detach();
  await page.waitForTimeout(1500);
  assert.equal(fixtureApiRequests, beforeWorkerStopApiRequests);
  assert.equal(await page.getByText("Count lines of code").count(), 1);
  const openActionPopup = async (tab: typeof page) => {
    await tab.bringToFront();
    const opened = await harness.evaluate(
      () =>
        new Promise<{ ok: boolean }>((resolve) =>
          chrome.tabs.query(
            { active: true, lastFocusedWindow: true },
            (tabs) => {
              const tabId = tabs[0]?.id;
              if (tabId === undefined) {
                resolve({ ok: false });
                return;
              }
              chrome.runtime.sendMessage(
                { type: "popup.open", targetTabId: tabId },
                resolve,
              );
            },
          ),
        ),
    );
    assert.equal(opened.ok, true);
  };
  const extensionUrl = `chrome-extension://${new URL(worker.url()).host}`;
  const actionPopup = async () => {
    const session = await context.newCDPSession(harness);
    let targetId: string | undefined;
    for (let attempt = 0; attempt < 100 && !targetId; attempt++) {
      const { targetInfos } = await session.send("Target.getTargets");
      const candidates = targetInfos.filter(
        (item) =>
          item.type === "page" && item.url === `${extensionUrl}/popup.html`,
      );
      assert.ok(candidates.length <= 1);
      targetId = candidates[0]?.targetId;
      if (!targetId) await harness.waitForTimeout(50);
    }
    assert.ok(targetId, "action popup opened");
    const { sessionId } = await session.send("Target.attachToTarget", {
      targetId,
      flatten: false,
    });
    let nextId = 0;
    const evaluate = async <T>(expression: string): Promise<T> => {
      const id = ++nextId;
      const result = new Promise<T>((resolve, reject) => {
        const listener = (event: { sessionId: string; message: string }) => {
          const message = JSON.parse(event.message) as {
            id?: number;
            error?: unknown;
            result?: {
              result?: { value?: unknown };
              exceptionDetails?: unknown;
            };
          };
          if (event.sessionId !== sessionId || message.id !== id) return;
          session.off("Target.receivedMessageFromTarget", listener);
          if (message.error || message.result?.exceptionDetails)
            reject(new Error(event.message));
          else resolve(message.result?.result?.value as T);
        };
        session.on("Target.receivedMessageFromTarget", listener);
      });
      await session.send("Target.sendMessageToTarget", {
        sessionId,
        message: JSON.stringify({
          id,
          method: "Runtime.evaluate",
          params: { expression, returnByValue: true },
        }),
      });
      return result;
    };
    const statusText = () =>
      evaluate<string>("document.querySelector('#status')?.textContent ?? ''");
    return {
      status: async (pattern: RegExp) => {
        for (let attempt = 0; attempt < 300; attempt++) {
          const text = await statusText();
          if (pattern.test(text)) return text;
          await harness.waitForTimeout(50);
        }
        throw new Error(`Action popup status: ${await statusText()}`);
      },
      click: (selector: string) =>
        evaluate<void>(
          `document.querySelector(${JSON.stringify(selector)}).click()`,
        ),
      close: async () => {
        await session.send("Target.closeTarget", { targetId });
        await session.detach();
      },
    };
  };
  const openPopup = async (tab: typeof page) => {
    await tab.bringToFront();
    const popup = await context.newPage();
    await popup.goto(`${extensionUrl}/popup.html`);
    await tab.bringToFront();
    await popup.reload();
    await popup.locator("#repository").waitFor({ state: "visible" });
    return popup;
  };
  await openActionPopup(page);
  const firstActionPopup = await actionPopup();
  await firstActionPopup.status(/^Ready to analyze main at /);
  await firstActionPopup.close();
  const popup = await openPopup(page);
  await popup
    .getByText(/Ready to analyze main at/)
    .waitFor({ timeout: 15_000 });
  assert.equal(await popup.locator("#repository-size").textContent(), "2 MB");
  assert.equal(
    await popup.locator("#snapshot-label").textContent(),
    `Files at ${publicSha.slice(0, 12)}`,
  );
  assert.equal(
    await popup.locator("#snapshot-size").textContent(),
    "Available after analysis",
  );
  await popup.getByRole("button", { name: "Analyze repository" }).focus();
  assert.equal(
    await popup
      .getByRole("button", { name: "Analyze repository" })
      .evaluate((button) => getComputedStyle(button).outlineStyle),
    "solid",
  );
  await popup.emulateMedia({ colorScheme: "light" });
  const lightPalette = await popup.locator("html").evaluate((element) => {
    const style = getComputedStyle(element);
    return [style.backgroundColor, style.color];
  });
  await popup.emulateMedia({ colorScheme: "dark" });
  const darkPalette = await popup.locator("html").evaluate((element) => {
    const style = getComputedStyle(element);
    return [style.backgroundColor, style.color];
  });
  assert.notDeepEqual(lightPalette, darkPalette);
  await popup.emulateMedia({ forcedColors: "active" });
  assert.equal(
    await popup
      .getByRole("button", { name: "Analyze repository" })
      .evaluate((button) => getComputedStyle(button).outlineStyle),
    "solid",
  );
  await popup.emulateMedia({ colorScheme: "light", forcedColors: "none" });
  assert.equal(fixtureArchiveRequests, 0);
  await popup.close();
  const interruptedLookupPopup = await context.newPage();
  await interruptedLookupPopup.addInitScript(() => {
    const connect = chrome.runtime.connect.bind(chrome.runtime);
    chrome.runtime.connect = ((info: chrome.runtime.ConnectInfo) => {
      const port = connect(info);
      const postMessage = port.postMessage.bind(port);
      port.postMessage = (message: { type?: string }) => {
        if (message.type === "repository.lookup")
          throw new Error("Extension unavailable");
        postMessage(message);
      };
      return port;
    }) as typeof chrome.runtime.connect;
  });
  await interruptedLookupPopup.goto(`${extensionUrl}/popup.html`);
  await page.bringToFront();
  await interruptedLookupPopup.reload();
  await interruptedLookupPopup
    .getByText("Extension unavailable. Reopen the popup to retry.")
    .waitFor();
  assert.equal(
    await interruptedLookupPopup
      .getByRole("button", { name: "Analyze repository" })
      .isEnabled(),
    true,
  );
  await interruptedLookupPopup.close();
  assert.equal(fixtureArchiveRequests, 0);
  const beforeFragmentApiRequests = fixtureApiRequests;
  await page.evaluate(() => {
    location.hash = "usage";
  });
  await page.waitForTimeout(150);
  assert.equal(await page.locator("[data-culverin-root]").count(), 1);
  assert.equal(fixtureApiRequests, beforeFragmentApiRequests);
  assert.equal(fixtureArchiveRequests, 0);
  const failedPopup = await openPopup(page);
  await failedPopup.getByRole("button", { name: "Analyze repository" }).click();
  await failedPopup
    .getByText(/Repository unavailable or access is restricted/)
    .waitFor({ timeout: 15_000 });
  assert.equal(fixtureArchiveRequests, 1);
  await failedPopup.close();
  await page.reload();
  await page.getByText("Count lines of code").waitFor();
  assert.equal(fixtureArchiveRequests, 1);
  await page.evaluate(() => {
    history.pushState({}, "", "/culverin/bootstrap-fixture/issues");
  });
  await page.locator("[data-culverin-root]").waitFor({ state: "detached" });
  await page.evaluate(() => {
    history.replaceState({}, "", "/culverin/bootstrap-fixture");
  });
  await page.getByText("Count lines of code").waitFor();
  assert.equal(await page.locator("[data-culverin-root]").count(), 1);
  assert.equal(fixtureArchiveRequests, 1);
  const originalRoot = await page
    .locator("[data-culverin-root]")
    .elementHandle();
  await page.evaluate(() => {
    history.pushState({}, "", "/culverin/bootstrap-other");
  });
  await page.waitForFunction((root) => !root.isConnected, originalRoot);
  await page.getByText("Count lines of code").waitFor();
  assert.equal(await page.locator("[data-culverin-root]").count(), 1);
  assert.equal(fixtureArchiveRequests, 1);
  const otherRoot = await page.locator("[data-culverin-root]").elementHandle();
  await page.evaluate(() => {
    history.back();
  });
  await page.waitForFunction((root) => !root.isConnected, otherRoot);
  await page.getByText("Count lines of code").waitFor();
  assert.equal(await page.locator("[data-culverin-root]").count(), 1);
  await page.evaluate(() => history.forward());
  await page.getByText("Count lines of code").waitFor();
  assert.equal(await page.locator("[data-culverin-root]").count(), 1);
  await page.evaluate(() => history.back());
  await page.getByText("Count lines of code").waitFor();
  assert.equal(await page.locator("[data-culverin-root]").count(), 1);
  const beforeReplacementApiRequests = fixtureApiRequests;
  await page.evaluate(() => {
    const about = document.querySelector("#about");
    if (!about) throw new Error("Missing About section");
    const replacement = about.cloneNode(true) as Element;
    replacement.querySelector("[data-culverin-root]")?.remove();
    about.replaceWith(replacement);
  });
  await page.waitForFunction(() =>
    document
      .querySelector("#about #forks")
      ?.parentElement?.nextElementSibling?.hasAttribute("data-culverin-root"),
  );
  await page.getByText("Count lines of code").waitFor();
  assert.equal(await summary.count(), 1);
  assert.equal(fixtureApiRequests, beforeReplacementApiRequests);
  await page.evaluate(() => sessionStorage.setItem("holdHydration", "1"));
  await page.reload();
  await page.waitForTimeout(800);
  assert.equal(await summary.count(), 0);
  await page.evaluate(() => {
    sessionStorage.removeItem("holdHydration");
    document.querySelector("#app")?.classList.add("loaded");
  });
  await summary.waitFor({ state: "attached" });
  assert.equal(await summary.getAttribute("hidden"), null);
  assert.equal(
    await summary.evaluate(
      (host) => host.previousElementSibling?.querySelector("a")?.id,
    ),
    "forks",
  );
  await page.getByText("Count lines of code").waitFor({ timeout: 1000 });
  await page.evaluate(() => sessionStorage.setItem("holdHydration", "1"));
  await page.reload();
  await page.waitForTimeout(800);
  assert.equal(await summary.count(), 0);
  await page.getByText("Count lines of code").waitFor({ timeout: 4000 });
  assert.equal(
    await page.evaluate(() => {
      sessionStorage.removeItem("holdHydration");
      return document.querySelector("#app")?.classList.contains("loaded");
    }),
    false,
  );
  await page.reload();
  await page.getByText("Count lines of code").waitFor();
  assert.equal(fixtureArchiveRequests, 1);
  fixtureMode = "slow";
  const started = new Promise<void>((resolve) => {
    slowArchiveStarted = resolve;
  });
  await page.getByText("Count lines of code").waitFor();
  const cancelPopup = await openPopup(page);
  await cancelPopup.getByRole("button", { name: "Analyze repository" }).click();
  await started;
  await page.evaluate(() => {
    location.hash = "readme";
  });
  await page.waitForTimeout(150);
  assert.equal(await page.locator("[data-culverin-root]").count(), 1);
  await cancelPopup.getByRole("button", { name: "Cancel analysis" }).click();
  await cancelPopup.getByText("Analysis canceled.").waitFor();
  await page.waitForTimeout(1700);
  assert.equal(await page.getByText("Count lines of code").count(), 1);
  await cancelPopup.close();
  const navigationArchive = new Promise<void>((resolve) => {
    slowArchiveStarted = resolve;
  });
  const navigatingPopup = await openPopup(page);
  await navigatingPopup
    .getByRole("button", { name: "Analyze repository" })
    .click();
  await navigationArchive;
  const popupJobs = await harness.evaluate(async () => {
    const state = await chrome.storage.session.get("github.job");
    return state["github.job"] as { owner: string }[] | undefined;
  });
  assert.equal(popupJobs?.length, 1);
  assert.ok(popupJobs?.[0]?.owner.startsWith("u:"));
  await page.evaluate(() => {
    history.pushState({}, "", "/culverin/bootstrap-fixture/issues");
  });
  await page.locator("[data-culverin-root]").waitFor({ state: "detached" });
  await navigatingPopup
    .getByText("The active tab changed. Reopen the popup to analyze it.")
    .waitFor();
  const canceledPopupJobs = await harness.evaluate(async () => {
    for (let attempt = 0; attempt < 100; attempt++) {
      const state = await chrome.storage.session.get("github.job");
      if (state["github.job"] === undefined) return undefined;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    return (await chrome.storage.session.get("github.job"))["github.job"];
  });
  assert.equal(canceledPopupJobs, undefined);
  fixtureMode = "ok";
  if (!navigatingPopup.isClosed()) await navigatingPopup.close();
  await page.evaluate(() => {
    history.replaceState({}, "", "/culverin/bootstrap-fixture");
  });
  await page.getByText("Count lines of code").waitFor({ timeout: 1000 });
  const retryPopup = await openPopup(page);
  await retryPopup.getByRole("button", { name: "Analyze repository" }).click();
  await retryPopup
    .getByText(/Repository unavailable or access is restricted/)
    .waitFor();
  await retryPopup.close();
  assert.equal(fixtureArchiveRequests, 4);
  fixtureMode = "slow";
  const switchedArchive = new Promise<void>((resolve) => {
    slowArchiveStarted = resolve;
  });
  const switchingPopup = await openPopup(page);
  await switchingPopup
    .getByRole("button", { name: "Analyze repository" })
    .click();
  await switchedArchive;
  const otherTab = await context.newPage();
  await otherTab.bringToFront();
  await switchingPopup
    .getByText("The active tab changed. Reopen the popup to analyze it.")
    .waitFor();
  await page.waitForTimeout(300);
  const switchedJobs = await harness.evaluate(async () => {
    const state = await chrome.storage.session.get("github.job");
    return state["github.job"] as { requestId: string }[] | undefined;
  });
  assert.equal(switchedJobs?.length, 1);
  const repositoryTabId = await harness.evaluate(
    async () =>
      (
        await chrome.tabs.query({
          url: "https://github.com/culverin/bootstrap-fixture*",
        })
      )[0]?.id,
  );
  const switchedCancel = await switchingPopup.evaluate(
    ({ tabId, targetRequestId }) =>
      new Promise<{ type?: string }>((resolve) => {
        const port = chrome.runtime.connect({ name: "culverin.popup" });
        const requestId = crypto.randomUUID();
        port.onMessage.addListener(
          (message: { requestId?: string; type?: string }) => {
            if (message.requestId !== requestId) return;
            port.disconnect();
            resolve(message);
          },
        );
        port.postMessage({
          protocolVersion: 1,
          type: "analysis.cancel",
          requestId,
          navigationId: crypto.randomUUID(),
          targetRequestId,
          tabId,
        });
      }),
    { tabId: repositoryTabId, targetRequestId: switchedJobs?.[0]?.requestId },
  );
  assert.equal(switchedCancel.type, "analysis.canceled");
  const switchedCanceledJobs = await harness.evaluate(async () => {
    for (let attempt = 0; attempt < 100; attempt++) {
      const state = await chrome.storage.session.get("github.job");
      if (state["github.job"] === undefined) return undefined;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    return (await chrome.storage.session.get("github.job"))["github.job"];
  });
  assert.equal(switchedCanceledJobs, undefined);
  await otherTab.close();
  await switchingPopup.close();
  fixtureMode = "ok";
  assert.equal(fixtureArchiveRequests, 5);
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
  await summary.waitFor({ state: "attached" });
  const emptyPopup = await openPopup(page);
  await emptyPopup
    .getByText("This repository has no default-branch commit to analyze.")
    .waitFor();
  await emptyPopup.close();
  await page.waitForTimeout(500);
  assert.equal(await summary.isHidden(), true);
  fixtureMode = "private";
  await clearPublicCache();
  await page.reload();
  await summary.waitFor({ state: "attached" });
  const privatePopup = await openPopup(page);
  await privatePopup
    .getByText(/Repository unavailable or access is restricted/)
    .waitFor();
  await privatePopup.close();
  await page.waitForTimeout(500);
  assert.equal(await summary.isHidden(), true);
  assert.equal(fixtureArchiveRequests, 5);
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
  const options = await context.newPage();
  await options.goto(
    `chrome-extension://${new URL(worker.url()).host}/options.html`,
  );
  assert.equal(await options.locator("input").count(), 0);
  assert.equal(await options.locator("details").count(), 0);
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
  await page.getByText("Count lines of code").waitFor();
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
  await resultPopup.status(/^Ready to analyze main at /);
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
  assert.equal(await page.getByText("Count lines of code").count(), 1);
  const resumedPopup = await openPopup(page);
  await resumedPopup
    .getByText("Analysis in progress. Closing the popup does not stop it.")
    .waitFor();
  await resumedPopup.getByRole("button", { name: "Cancel analysis" }).waitFor();
  assert.equal(
    await resumedPopup
      .getByRole("button", { name: "Analyze repository" })
      .isDisabled(),
    true,
  );
  await worker.evaluate(() =>
    (
      globalThis as typeof globalThis & { fixtureRelease?: () => void }
    ).fixtureRelease?.(),
  );
  await resumedPopup
    .getByText("Analyzed locally.")
    .waitFor({ timeout: 15_000 });
  await resumedPopup.getByText("1 code lines", { exact: true }).waitFor();
  await resumedPopup
    .getByText(
      /Source profile coverage: 2 of 2 regular files counted; 0 skipped/,
    )
    .waitFor();
  assert.equal(
    await resumedPopup.locator("#repository-size").textContent(),
    "2 MB",
  );
  assert.equal(
    await resumedPopup.locator("#snapshot-size").textContent(),
    "21 B",
  );
  assert.equal(
    await resumedPopup.locator("#text-lines").textContent(),
    "1 text lines",
  );
  assert.deepEqual(
    await resumedPopup
      .locator("#detail-content ul")
      .evaluateAll((lists) =>
        lists.map((list) => [
          list.previousElementSibling?.textContent,
          list.getAttribute("aria-label"),
          Array.from(list.children, (item) => item.textContent),
        ]),
      ),
    [
      [
        "Code",
        "Languages by code lines",
        ["Rust: 1 code lines (100.0% of code lines), 1 files"],
      ],
      [
        "Text",
        "Text formats by text lines",
        ["Plain Text: 1 text lines (100.0% of text lines), 1 files"],
      ],
    ],
  );
  await page.getByText("1 line of code", { exact: true }).waitFor();
  const disclosure = resumedPopup.locator("#details");
  await disclosure.locator("summary").focus();
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
    "Cached local analysis. Public visibility metadata may be up to one minute old.";
  await restartPopup.getByText(cachedStatus).waitFor();
  const restartControl = await context.newCDPSession(page);
  await restartControl.send("ServiceWorker.enable");
  await restartControl.send("ServiceWorker.stopAllWorkers");
  await restartControl.detach();
  await page.waitForTimeout(1000);
  await restartPopup
    .getByRole("button", { name: "Analyze repository" })
    .click();
  await restartPopup.waitForFunction(
    () =>
      document.querySelector("#status")?.textContent !==
      "Resolving default branch…",
  );
  assert.equal(
    await restartPopup.locator("#status").textContent(),
    cachedStatus,
  );
  await restartPopup.getByText("1 code lines", { exact: true }).waitFor();
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
    const current = await chrome.storage.session.get("github.generation");
    const submissionId = crypto.randomUUID();
    await chrome.storage.session.set({
      "github.pending": {
        token: "fixture-token",
        submissionId,
        generation: current["github.generation"],
        owner: "culverin",
        name: "bootstrap-fixture",
        createdAt: Date.now(),
      },
    });
    const submitted = await new Promise<unknown>((resolve) =>
      chrome.runtime.sendMessage(
        {
          protocolVersion: 1,
          type: "auth.submit",
          requestId: crypto.randomUUID(),
          navigationId: crypto.randomUUID(),
          submissionId,
        },
        (reply: unknown) => {
          void chrome.runtime.lastError;
          resolve(reply);
        },
      ),
    );
    const idle = await send("analysis.status");
    const cleared = await send("auth.clear-private-session");
    const disconnected = await send("auth.disconnect");
    const after = await send("auth.status");
    return {
      initial,
      submitted,
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
  assert.equal(optionsState.submitted, undefined);
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
  assert.equal(fixtureArchiveRequests, 5);
  const interruptionCdp = await context.newCDPSession(harness);
  let interruptedVersion: string | undefined;
  interruptionCdp.on("ServiceWorker.workerVersionUpdated", (event) => {
    for (const version of event.versions)
      if (version.status === "activated")
        interruptedVersion = version.versionId;
  });
  await interruptionCdp.send("ServiceWorker.enable");
  await page.goto("https://github.com/culverin/bootstrap-fixture");
  await page.getByText("1 line of code", { exact: true }).waitFor();
  assert.equal(fixtureArchiveRequests, 5);
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
  await page.getByText("Count lines of code").waitFor();
  const partialPopup = await openPopup(page);
  await partialPopup.getByText(/Ready to analyze main at/).waitFor();
  await partialPopup
    .getByRole("button", { name: "Analyze repository" })
    .click();
  await partialPopup
    .getByText("Partial local analysis.")
    .waitFor({ timeout: 15_000 });
  assert.equal(await page.getByText("Count lines of code").count(), 1);
  await partialPopup.close();
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
  await page.getByText("Count lines of code").waitFor();
  fixtureMode = "slow";
  const interruptedArchive = new Promise<void>((resolve) => {
    slowArchiveStarted = resolve;
  });
  const interruptedPopup = await openPopup(page);
  await interruptedPopup
    .getByRole("button", { name: "Analyze repository" })
    .click();
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
  await interruptedPopup
    .getByText(/Analysis was interrupted/)
    .waitFor({ timeout: 15_000 });
  await page.waitForTimeout(1700);
  assert.equal(fixtureArchiveRequests, 6);
  await interruptedPopup.close();
  fixtureMode = "ok";
  const recoveryPopup = await openPopup(page);
  await recoveryPopup
    .getByRole("button", { name: "Analyze repository" })
    .click();
  await recoveryPopup
    .getByText(/Repository unavailable or access is restricted/)
    .waitFor({ timeout: 15_000 });
  assert.equal(fixtureArchiveRequests, 7);
  await recoveryPopup.close();
  await interruptionCdp.detach();
  fixtureMode = "shared";
  await page.reload();
  await page.getByText("Count lines of code").waitFor();
  const detachedArchive = new Promise<void>((resolve) => {
    slowArchiveStarted = resolve;
  });
  const detachedPopup = await openPopup(page);
  await detachedPopup
    .getByRole("button", { name: "Analyze repository" })
    .click();
  await detachedArchive;
  await detachedPopup.close();
  await page.waitForTimeout(300);
  const continuingJobs = await options.evaluate(async () => {
    const state = await chrome.storage.session.get("github.job");
    return state["github.job"] as { owner: string }[] | undefined;
  });
  assert.equal(continuingJobs?.length, 1);
  const detachedJobs = await options.evaluate(async () => {
    for (let attempt = 0; attempt < 500; attempt++) {
      const state = await chrome.storage.session.get("github.job");
      if (state["github.job"] === undefined) return undefined;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    return (await chrome.storage.session.get("github.job"))["github.job"];
  });
  assert.equal(detachedJobs, undefined);
  assert.equal(fixtureArchiveRequests, 8);
  assert.equal(await page.getByText("Count lines of code").count(), 1);
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
    let livePopup = await openPopup(livePage);
    await livePopup
      .getByRole("button", { name: "Analyze repository" })
      .waitFor({ timeout: 30_000 });
    await livePopup.getByText(/Ready to analyze/).waitFor({ timeout: 30_000 });
    const beforeClick = requests.filter(
      (request) => request.origin === "https://codeload.github.com",
    ).length;
    await livePopup.close();
    await livePage.reload({ waitUntil: "commit", timeout: 60_000 });
    livePopup = await openPopup(livePage);
    await livePopup.getByText(/Ready to analyze/).waitFor({ timeout: 30_000 });
    assert.equal(
      requests.filter(
        (request) => request.origin === "https://codeload.github.com",
      ).length,
      beforeClick,
    );
    await livePopup.getByRole("button", { name: "Analyze repository" }).click();
    await livePopup
      .getByText(/Analyzed locally.|Partial local analysis./)
      .waitFor({ timeout: 30_000 });
    assert.equal(
      requests.filter(
        (request) => request.origin === "https://codeload.github.com",
      ).length,
      beforeClick + 1,
    );
    await livePopup.close();
    await livePage.close();
    const beforeOptionsLookup = requests.filter(
      (request) => request.origin === "https://codeload.github.com",
    ).length;
    const sendLive = (type: string) =>
      options.evaluate(
        (type) =>
          new Promise<{
            state?: string;
            resolution?: { visibility: string };
          }>((resolve) =>
            chrome.runtime.sendMessage(
              {
                protocolVersion: 1,
                type,
                requestId: crypto.randomUUID(),
                navigationId: crypto.randomUUID(),
                owner: "octocat",
                name: "Hello-World",
              },
              resolve,
            ),
          ),
        type,
      );
    const lookup = await sendLive("repository.lookup");
    assert.equal(lookup.state, "resolved");
    assert.equal(lookup.resolution?.visibility, "public");
    assert.equal(
      requests.filter(
        (request) => request.origin === "https://codeload.github.com",
      ).length,
      beforeOptionsLookup,
    );
    assert.equal((await sendLive("analysis.request")).state, "analyzed");
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
  assert.equal(archivedResult.totals.files, 2);
  assert.equal(archivedResult.totals.lines, 2);
  assert.equal(archivedResult.totals.code, 1);
  assert.equal(archivedResult.coverage.regularFiles, 2);
  assert.equal(archivedResult.coverage.skippedByReason.unsupported_language, 0);
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
  await page.getByText("Count lines of code").waitFor();
  const zeroPopup = await openPopup(page);
  await zeroPopup.getByRole("button", { name: "Analyze repository" }).click();
  await zeroPopup.getByText("0 code lines", { exact: true }).waitFor();
  const zeroDetails = await zeroPopup.locator("#detail-content").textContent();
  assert.ok(
    zeroDetails?.includes("No language totals.") ||
      zeroDetails?.includes("0.0% of code lines"),
  );
  assert.equal(await zeroPopup.getByText(/NaN|Infinity/).count(), 0);
  await page.getByText("0 lines of code", { exact: true }).waitFor();
  await zeroPopup.close();
  await page.evaluate(() =>
    history.pushState({}, "", "/culverin/bootstrap-fixture"),
  );
  await clearPublicCache();
  await page.reload();
  const countButton = page.getByRole("button", {
    name: "Count lines of code",
  });
  const rowTitle = () =>
    summary.evaluate((host) =>
      host.shadowRoot?.querySelector(".row")?.getAttribute("title"),
    );
  await countButton.waitFor();
  await summary.evaluate((host) =>
    (host.shadowRoot?.querySelector("button") as HTMLButtonElement).click(),
  );
  await page.waitForTimeout(500);
  assert.equal(await countButton.count(), 1);
  await summary.evaluate((host) => {
    const labels: string[] = [];
    const live = host.shadowRoot!.querySelector("[aria-live]")!;
    new MutationObserver(() => labels.push(live.textContent ?? "")).observe(
      live,
      { childList: true, subtree: true, characterData: true },
    );
    (window as typeof window & { culverinLabels?: string[] }).culverinLabels =
      labels;
  });
  await countButton.click();
  await page
    .getByText("0 lines of code", { exact: true })
    .waitFor({ timeout: 15_000 });
  assert.equal(await rowTitle(), "0 lines of code. Open Culverin for details");
  assert.equal(
    await page.getByRole("button", { name: "0 lines of code" }).count(),
    1,
  );
  const pageLabels = await page.evaluate(
    () =>
      (window as typeof window & { culverinLabels?: string[] }).culverinLabels,
  );
  assert.equal(pageLabels?.[0], "Preparing to count lines…");
  assert.ok(
    pageLabels?.some((label) =>
      ["Downloading source…", "Unpacking source…", "Counting lines…"].includes(
        label,
      ),
    ),
    `progress labels: ${pageLabels?.join(", ")}`,
  );
  await zeroWorker.evaluate((sha) => {
    const scope = globalThis as typeof globalThis & {
      pageOriginalFetch?: typeof fetch;
      pageFetchCount?: number;
      pageRelease?: () => void;
    };
    scope.pageOriginalFetch = fetch;
    scope.pageFetchCount = 0;
    globalThis.fetch = (async (input, init) => {
      if (String(input).endsWith(`/tarball/${sha}`)) {
        scope.pageFetchCount = (scope.pageFetchCount ?? 0) + 1;
        await new Promise<void>((resolve, reject) => {
          scope.pageRelease = resolve;
          init?.signal?.addEventListener(
            "abort",
            () => reject(new DOMException("Aborted", "AbortError")),
            { once: true },
          );
        });
        return new Response(null, { status: 404 });
      }
      return scope.pageOriginalFetch!(input, init);
    }) as typeof fetch;
  }, publicSha);
  const pageFetches = (count: number) =>
    zeroWorker.evaluate(async (count) => {
      const scope = globalThis as typeof globalThis & {
        pageFetchCount?: number;
      };
      for (let attempt = 0; attempt < 250; attempt++) {
        if ((scope.pageFetchCount ?? 0) >= count) return scope.pageFetchCount;
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      return scope.pageFetchCount;
    }, count);
  await clearPublicCache();
  await page.reload();
  await countButton.click();
  assert.equal(await pageFetches(1), 1);
  const running = page.getByRole("button", {
    name: "Preparing to count lines…",
  });
  await running.waitFor();
  assert.equal(await rowTitle(), "Click to cancel");
  await running.click();
  await countButton.waitFor();
  const canceledPageJobs = await options.evaluate(async () => {
    for (let attempt = 0; attempt < 100; attempt++) {
      const state = await chrome.storage.session.get("github.job");
      if (state["github.job"] === undefined) return undefined;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    return (await chrome.storage.session.get("github.job"))["github.job"];
  });
  assert.equal(canceledPageJobs, undefined);
  await page.waitForTimeout(500);
  assert.equal(await countButton.count(), 1);
  await countButton.click();
  assert.equal(await pageFetches(2), 2);
  await zeroWorker.evaluate(() =>
    (
      globalThis as typeof globalThis & { pageRelease?: () => void }
    ).pageRelease?.(),
  );
  const retryButton = page.getByRole("button", {
    name: "Couldn't count lines · Retry",
  });
  await retryButton.waitFor({ timeout: 15_000 });
  assert.ok((await rowTitle())?.length);
  await zeroWorker.evaluate(() => {
    const scope = globalThis as typeof globalThis & {
      pageOriginalFetch?: typeof fetch;
      pageFetchCount?: number;
      pageRelease?: () => void;
    };
    if (scope.pageOriginalFetch) globalThis.fetch = scope.pageOriginalFetch;
    delete scope.pageOriginalFetch;
    delete scope.pageFetchCount;
    delete scope.pageRelease;
  });
  await page.setViewportSize({ width: 600, height: 720 });
  await page.reload();
  await page.waitForTimeout(1000);
  assert.equal(await summary.count(), 0);
  await page.setViewportSize({ width: 1280, height: 720 });
  await countButton.waitFor();
  assert.equal(await summary.count(), 1);
  fixtureMode = "rate";
  await clearPublicCache();
  await page.reload();
  await page.getByText("GitHub rate limit, try later").waitFor();
  assert.match(
    (await summary.evaluate((host) =>
      host.shadowRoot?.querySelector(".row")?.getAttribute("title"),
    )) ?? "",
    /^GitHub rate limit reached. Retry after /,
  );
  assert.equal(await page.getByRole("button", { name: /lines/ }).count(), 0);
  const limitedPopup = await openPopup(page);
  await limitedPopup
    .getByText(/GitHub rate limit reached. Retry after/)
    .waitFor();
  const limitedRequests = fixtureApiRequests;
  await limitedPopup.close();
  await page.reload();
  const cachedLimitPopup = await openPopup(page);
  await cachedLimitPopup
    .getByText(/GitHub rate limit reached. Retry after/)
    .waitFor();
  assert.equal(fixtureApiRequests, limitedRequests);
  await cachedLimitPopup.close();
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
