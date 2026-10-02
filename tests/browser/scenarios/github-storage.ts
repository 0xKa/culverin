import assert from "node:assert/strict";
import type { runPageCounting } from "./page-counting";
export async function runGithubStorage(
  state: Awaited<ReturnType<typeof runPageCounting>>,
) {
  const {
    context,
    settingsPage,
    extensionUrl,
    fixtures,
    worker,
    publicFixtureBytes,
    publicSha,
    page,
    countButton,
    savedPublicResults,
    harness,
    openPopup,
    outcome,
  } = state;

  const deviceBodies: string[] = [];

  let devicePolls = 0;

  let releaseDeviceCode!: () => void;

  const deviceCodeGate = new Promise<void>((resolve) => {
    releaseDeviceCode = resolve;
  });

  await context.route("https://github.com/login/device/code", async (route) => {
    await deviceCodeGate;
    deviceBodies.push(route.request().postData() ?? "");
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        device_code: "fixture-device",
        user_code: "ABCD-1234",
        verification_uri: "https://github.com/login/device",
        expires_in: 900,
        interval: 1,
      }),
    });
  });

  await context.route(
    "https://github.com/login/oauth/access_token",
    (route) => {
      deviceBodies.push(route.request().postData() ?? "");
      devicePolls++;
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(
          devicePolls === 1
            ? { error: "authorization_pending" }
            : {
                access_token: "fixture-app-token",
                token_type: "bearer",
                expires_in: 28800,
                refresh_token: "fixture-refresh-token",
                refresh_token_expires_in: 15897600,
              },
        ),
      });
    },
  );

  let tokenGate: Promise<void> | undefined;

  await context.route("https://api.github.com/user", async (route) => {
    await tokenGate;
    const authorization = route.request().headers()["authorization"];
    return route.fulfill(
      authorization === "Bearer fixture-app-token" ||
        authorization === "Bearer fixture-token"
        ? {
            status: 200,
            contentType: "application/json",
            headers: {
              "x-ratelimit-limit": "5000",
              "x-ratelimit-remaining": "4990",
              "x-ratelimit-reset": String(Math.floor(Date.now() / 1000) + 3600),
              "x-ratelimit-resource": "core",
            },
            body: JSON.stringify({ login: "fixture-user" }),
          }
        : { status: 401, contentType: "application/json", body: "{}" },
    );
  });

  await settingsPage.goto(`${extensionUrl}/settings.html#github`);

  const githubSection = settingsPage.locator("section", {
    has: settingsPage.locator("#github-heading"),
  });

  await githubSection
    .getByText("Not connected. Culverin counts public repositories only.")
    .waitFor();

  await githubSection
    .getByRole("button", { name: "Connect with GitHub" })
    .click();

  const connectButton = settingsPage.locator("#github-connect");

  await connectButton.getByText("Connecting…").waitFor();

  assert.equal(await connectButton.isDisabled(), true);

  assert.equal(await connectButton.getAttribute("aria-busy"), "true");

  await connectButton.locator(".culverin-spinner").waitFor();

  releaseDeviceCode();

  await settingsPage.locator("#github-device-code").waitFor();

  assert.equal(await githubSection.locator(".culverin-spinner").count(), 0);

  await githubSection.getByText(/Waiting for approval on GitHub/).waitFor();

  assert.equal(
    await settingsPage.locator("#github-device-code").textContent(),
    "ABCD-1234",
  );

  await githubSection
    .getByText("Connected as @fixture-user with the Culverin GitHub App.")
    .waitFor({ timeout: 15_000 });

  assert.equal(devicePolls, 2);

  for (const body of deviceBodies) {
    const fields = new URLSearchParams(body);
    assert.equal(fields.get("client_id"), "Iv23lipbFBghKf7NMjQi");
    assert.equal(fields.has("client_secret"), false);
  }

  const appConnection = await settingsPage.evaluate(async () => {
    const stored = (await chrome.storage.local.get("github.connection"))[
      "github.connection"
    ] as { credential?: Record<string, unknown> };
    return {
      method: stored.credential?.method,
      login: stored.credential?.login,
      refresh: typeof stored.credential?.refreshToken,
      device: await chrome.storage.session.get("github.device"),
    };
  });

  assert.deepEqual(appConnection, {
    method: "app",
    login: "fixture-user",
    refresh: "string",
    device: {},
  });

  await githubSection.getByRole("button", { name: "Disconnect" }).click();

  await githubSection
    .getByText(
      "Disconnected. The saved token and private results were deleted.",
    )
    .waitFor();

  await githubSection.getByText("Use a personal access token instead").click();

  await settingsPage.locator("#github-token").fill("wrong-token");

  let releaseTokenCheck!: () => void;

  tokenGate = new Promise<void>((resolve) => {
    releaseTokenCheck = resolve;
  });

  await githubSection.getByRole("button", { name: "Save token" }).click();

  const tokenButton = settingsPage.locator("#github-token-save");

  await tokenButton.getByText("Checking token…").waitFor();

  await tokenButton.locator(".culverin-spinner").waitFor();

  assert.equal(await tokenButton.isDisabled(), true);

  assert.equal(await tokenButton.getAttribute("aria-busy"), "true");

  assert.equal(await settingsPage.locator("#github-token").isDisabled(), true);

  tokenGate = undefined;

  releaseTokenCheck();

  await githubSection.getByText(/didn't accept that token/).waitFor();

  assert.equal(await tokenButton.textContent(), "Save token");

  assert.equal(await tokenButton.isDisabled(), false);

  assert.equal(await githubSection.locator(".culverin-spinner").count(), 0);

  await settingsPage.locator("#github-token").fill("fixture-token");

  await githubSection.getByRole("button", { name: "Save token" }).click();

  await githubSection
    .getByText("Connected as @fixture-user with a personal access token.")
    .waitFor();

  assert.equal(await settingsPage.locator("#github-token").count(), 0);

  assert.equal(await githubSection.locator(".culverin-spinner").count(), 0);

  fixtures.mode = "private";

  await worker.evaluate(
    ({ bytes, sha }) => {
      const scope = globalThis as typeof globalThis & {
        fixtureOriginalFetch?: typeof fetch;
        fixtureArchiveAuthorization?: string | null;
      };
      scope.fixtureOriginalFetch = fetch;
      globalThis.fetch = (async (input, init) => {
        if (String(input).endsWith(`/tarball/${sha}`)) {
          scope.fixtureArchiveAuthorization = new Headers(init?.headers).get(
            "authorization",
          );
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

  await page.reload();

  await countButton.click();

  const privateTotal = page.getByRole("button", { name: /lines? of code$/ });

  await privateTotal.waitFor({ timeout: 15_000 });

  assert.equal(fixtures.authorization, "Bearer fixture-token");

  assert.equal(
    await worker.evaluate(
      () =>
        (
          globalThis as typeof globalThis & {
            fixtureArchiveAuthorization?: string | null;
          }
        ).fixtureArchiveAuthorization,
    ),
    "Bearer fixture-token",
  );

  const privateStorage = async () =>
    settingsPage.evaluate(async () => {
      const state = await chrome.storage.local.get([
        "culverin.private-results.v1",
        "culverin.public-results.v1",
      ]);
      const count = (key: string) =>
        (state[key] as { entries?: unknown[] } | undefined)?.entries?.length ??
        0;
      return {
        private: count("culverin.private-results.v1"),
        public: count("culverin.public-results.v1"),
      };
    });

  assert.deepEqual(await privateStorage(), { private: 1, public: 0 });

  const beforePrivateReload = fixtures.apiRequests;

  await page.reload();

  await privateTotal.waitFor();

  assert.equal(fixtures.apiRequests, beforePrivateReload);

  await settingsPage.getByRole("link", { name: "Storage" }).click();

  await settingsPage
    .locator("#private-summary", { hasText: "1 result for 1 repository" })
    .waitFor();

  assert.equal(
    await githubSection
      .getByRole("button", { name: "Clear private results" })
      .count(),
    0,
  );

  const savedPrivateResults = await settingsPage.evaluate(() =>
    chrome.storage.local.get("culverin.private-results.v1"),
  );

  const settingsBeforeClear = await settingsPage.evaluate(() =>
    chrome.storage.sync.get(null),
  );

  const beforeClearApiRequests = fixtures.apiRequests;

  const beforeClearArchiveRequests = fixtures.archiveRequests;

  const restoreResults = async () => {
    await settingsPage.evaluate(
      (results) => chrome.storage.local.set(results),
      { ...savedPublicResults, ...savedPrivateResults },
    );
    await settingsPage
      .locator("#cache-summary", { hasText: "1 result for 1 repository" })
      .waitFor();
    await settingsPage
      .locator("#private-summary", { hasText: "1 result for 1 repository" })
      .waitFor();
  };

  await restoreResults();

  const untrustedClearAll = await harness.evaluate(
    () =>
      new Promise<string>((resolve) =>
        chrome.runtime.sendMessage(
          {
            protocolVersion: 1,
            type: "cache.clear-all",
            requestId: crypto.randomUUID(),
            navigationId: crypto.randomUUID(),
          },
          () => resolve(chrome.runtime.lastError ? "rejected" : "handled"),
        ),
      ),
  );

  assert.equal(untrustedClearAll, "rejected");

  assert.deepEqual(await privateStorage(), { private: 1, public: 1 });

  await settingsPage
    .getByRole("button", { name: "Clear public results" })
    .click();

  await settingsPage.getByText("Public results cleared.").waitFor();

  await settingsPage
    .locator("#cache-summary", { hasText: "No saved results." })
    .waitFor();

  assert.deepEqual(await privateStorage(), { private: 1, public: 0 });

  await restoreResults();

  await settingsPage
    .getByRole("button", { name: "Clear private results" })
    .click();

  await settingsPage.getByText("Private results cleared.").waitFor();

  await settingsPage
    .locator("#private-summary", { hasText: "No saved results." })
    .waitFor();

  assert.deepEqual(await privateStorage(), { private: 0, public: 1 });

  await restoreResults();

  await settingsPage.getByRole("button", { name: "Clear all results" }).click();

  await settingsPage.getByText("All results cleared.").waitFor();

  await settingsPage
    .locator("#cache-summary", { hasText: "No saved results." })
    .waitFor();

  await settingsPage
    .locator("#private-summary", { hasText: "No saved results." })
    .waitFor();

  assert.deepEqual(await privateStorage(), { private: 0, public: 0 });

  assert.deepEqual(
    await settingsPage.evaluate(() => chrome.storage.sync.get(null)),
    settingsBeforeClear,
  );

  const credentialKept = await settingsPage.evaluate(async () => {
    const stored = (await chrome.storage.local.get("github.connection"))[
      "github.connection"
    ] as { credential?: { method: string; login: string; token: string } };
    return (
      stored.credential?.method === "token" &&
      stored.credential.login === "fixture-user" &&
      stored.credential.token === "fixture-token"
    );
  });

  assert.equal(credentialKept, true);

  assert.equal(fixtures.apiRequests, beforeClearApiRequests);

  assert.equal(fixtures.archiveRequests, beforeClearArchiveRequests);

  await settingsPage.getByRole("link", { name: "GitHub" }).click();

  await githubSection
    .getByText("Connected as @fixture-user with a personal access token.")
    .waitFor();

  await githubSection.getByRole("button", { name: "Disconnect" }).click();

  await githubSection
    .getByText("Not connected. Culverin counts public repositories only.")
    .waitFor();

  const disconnected = await settingsPage.evaluate(async () => {
    const stored = (await chrome.storage.local.get("github.connection"))[
      "github.connection"
    ] as { credential?: unknown };
    return stored.credential === undefined;
  });

  assert.equal(disconnected, true);

  await worker.evaluate(() => {
    const scope = globalThis as typeof globalThis & {
      fixtureOriginalFetch?: typeof fetch;
    };
    if (scope.fixtureOriginalFetch)
      globalThis.fetch = scope.fixtureOriginalFetch;
    delete scope.fixtureOriginalFetch;
  });

  fixtures.mode = "ok";

  await settingsPage.getByRole("link", { name: "Culverin ignore" }).click();

  await settingsPage.locator("#rules").waitFor({ state: "visible" });

  await settingsPage.waitForFunction(
    () => localStorage.getItem("culverin.settings.section") === "ignore",
  );

  await settingsPage.close();

  const settingsLauncher = await openPopup(page);

  const openedSettings = context.waitForEvent("page");

  await settingsLauncher.getByRole("button", { name: "Settings" }).click();

  const openedSettingsPage = await openedSettings;

  await openedSettingsPage.waitForLoadState();

  assert.equal(new URL(openedSettingsPage.url()).pathname, "/settings.html");

  assert.equal(await openedSettingsPage.title(), "Culverin settings");

  await openedSettingsPage.locator("#rules").waitFor({ state: "visible" });

  assert.equal(
    await openedSettingsPage
      .getByRole("link", { name: "Culverin ignore" })
      .getAttribute("aria-current"),
    "page",
  );

  await openedSettingsPage.getByRole("link", { name: "Storage" }).click();

  await openedSettingsPage
    .getByRole("button", { name: "Clear public results" })
    .waitFor({ state: "visible" });

  await openedSettingsPage.waitForFunction(
    () => localStorage.getItem("culverin.settings.section") === "storage",
  );

  await openedSettingsPage.close();

  const reopenedSettings = context.waitForEvent("page");

  await settingsLauncher.getByRole("button", { name: "Settings" }).click();

  const reopenedSettingsPage = await reopenedSettings;

  await reopenedSettingsPage
    .getByRole("button", { name: "Clear public results" })
    .waitFor({ state: "visible" });

  assert.equal(new URL(reopenedSettingsPage.url()).hash, "#storage");

  assert.equal(
    await reopenedSettingsPage
      .getByRole("link", { name: "Storage" })
      .getAttribute("aria-current"),
    "page",
  );

  await reopenedSettingsPage.close();

  await settingsLauncher.close();

  console.log(
    `Browser count ${outcome.countMs.toFixed(2)} ms, JS heap ${outcome.memory ?? "unavailable"} bytes`,
  );

  console.log(
    "Browser smoke passed: packaged WASM counted under CSP and recovered after trap",
  );
  return { ...state };
}
