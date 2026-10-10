import assert from "node:assert/strict";
import type { runPopupResults } from "./popup-results";
export async function runIgnoreAccess(
  state: Awaited<ReturnType<typeof runPopupResults>>,
) {
  const {
    context,
    settingsPage,
    worker,
    publicFixtureBytes,
    publicSha,
    openPopup,
    page,
    settingsNav,
    cachedStatus,
    fixtures,
  } = state;

  await settingsPage.reload();

  await settingsPage
    .locator("#github-connection")
    .filter({ hasText: /\S/ })
    .waitFor({ state: "attached" });

  await settingsPage.locator("#rules").fill("README\n");

  await settingsPage.getByRole("button", { name: "Save" }).click();

  await settingsPage
    .locator("#ignore-status")
    .getByText(/^Saved\./)
    .waitFor();

  assert.deepEqual(
    await settingsPage.evaluate(
      async () =>
        (
          (await chrome.storage.sync.get("culverin.ignore"))[
            "culverin.ignore"
          ] as { exclusions?: string[] } | undefined
        )?.exclusions,
    ),
    ["README"],
  );

  assert.equal(
    await settingsPage.locator("#ignore-status-mark").getAttribute("data-mark"),
    "done",
  );

  await settingsPage.locator("#rules").pressSequentially("x");

  await settingsPage
    .locator("#ignore-status-mark")
    .waitFor({ state: "detached" });

  await settingsPage.locator("#rules").fill("README\n");

  const firstGroup = settingsPage.locator("#groups input").first();

  await firstGroup.uncheck();

  await settingsPage
    .locator('#ignore-groups-status-mark[data-mark="done"]')
    .waitFor();

  assert.equal(await settingsPage.locator("#ignore-status-mark").count(), 0);

  await firstGroup.check();

  await settingsPage.waitForFunction(async () => {
    const stored = (await chrome.storage.sync.get("culverin.ignore"))[
      "culverin.ignore"
    ] as { disabledGroups?: string[] } | undefined;
    return stored?.disabledGroups?.length === 0;
  });

  await worker.evaluate(
    ({ bytes, sha }) => {
      const scope = globalThis as typeof globalThis & {
        fixtureOriginalFetch?: typeof fetch;
      };
      scope.fixtureOriginalFetch = fetch;
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
        return scope.fixtureOriginalFetch!(input, init);
      }) as typeof fetch;
    },
    { bytes: publicFixtureBytes, sha: publicSha },
  );

  const ignorePopup = await openPopup(page);

  await ignorePopup
    .getByText(/Culverin ignore changed since the last count\./)
    .waitFor();

  assert.equal(
    await ignorePopup.locator("#ignore-text").textContent(),
    "Culverin ignore: 1 rule",
  );

  await ignorePopup.getByRole("button", { name: "Analyze repository" }).click();

  await ignorePopup
    .getByText("Analyzed locally.", { exact: true })
    .waitFor({ timeout: 15_000 });

  await ignorePopup
    .getByText(
      /Source profile coverage: 1 of 14 regular files counted; 13 skipped \(1 excluded by Culverin ignore, 12 other files,/,
    )
    .waitFor();

  assert.equal(await ignorePopup.locator("#text-lines").textContent(), "0");

  assert.equal(
    await ignorePopup.locator("#snapshot-size").textContent(),
    "47 B",
  );

  await settingsNav.getByRole("link", { name: "Storage" }).click();

  await settingsPage.locator("#rules").waitFor({ state: "hidden" });

  const pagesBeforeEdit = context.pages().length;

  await ignorePopup.getByRole("button", { name: "Edit" }).click();

  await settingsPage.locator("#rules").waitFor({ state: "visible" });

  assert.equal(new URL(settingsPage.url()).hash, "#ignore");

  await ignorePopup.waitForTimeout(300);

  assert.equal(context.pages().length, pagesBeforeEdit);

  await ignorePopup.close();

  const ignoredRow = page.getByRole("button", {
    name: "1 line of code",
    exact: true,
  });

  await page.waitForFunction(
    () =>
      document
        .querySelector("[data-culverin-root]")
        ?.shadowRoot?.querySelector("[title]")
        ?.getAttribute("title")
        ?.includes("Culverin ignore active") ?? false,
  );

  assert.match(
    (await ignoredRow.getAttribute("title")) ?? "",
    /^1 line of code \(Culverin ignore active\)$/,
  );

  settingsPage.once("dialog", (dialog) => void dialog.accept());

  await settingsPage.getByRole("button", { name: "Reset to defaults" }).click();

  await settingsPage
    .locator("#ignore-status")
    .getByText(/^Saved\./)
    .waitFor();

  assert.equal(await settingsPage.locator("#rules").inputValue(), "");

  const resetPopup = await openPopup(page);

  await resetPopup.getByText(cachedStatus).waitFor();

  assert.equal(await resetPopup.locator("#ignore-summary").isHidden(), true);

  await resetPopup.locator("#text-lines", { hasText: /^1$/ }).waitFor();

  await resetPopup.close();

  await worker.evaluate(() => {
    const scope = globalThis as typeof globalThis & {
      fixtureOriginalFetch?: typeof fetch;
    };
    if (scope.fixtureOriginalFetch)
      globalThis.fetch = scope.fixtureOriginalFetch;
    delete scope.fixtureOriginalFetch;
  });

  const settingsState = await settingsPage.evaluate(async () => {
    const send = (type: string, extra: Record<string, unknown> = {}) =>
      new Promise<{ state: string; connected?: boolean; code?: string }>(
        (resolve) =>
          chrome.runtime.sendMessage(
            {
              protocolVersion: 1,
              type,
              requestId: crypto.randomUUID(),
              navigationId: crypto.randomUUID(),
              ...extra,
            },
            resolve,
          ),
      );
    const initial = await send("auth.status");
    const submissionId = crypto.randomUUID();
    await chrome.storage.session.set({
      "github.pending": {
        token: "fixture-token",
        submissionId,
        createdAt: Date.now(),
      },
    });
    const mismatched = await send("auth.submit", {
      submissionId: crypto.randomUUID(),
    });
    const idle = await send("analysis.status");
    const cleared = await send("auth.clear-private-session");
    const disconnected = await send("auth.disconnect");
    const after = await send("auth.status");
    const connection = (await chrome.storage.local.get("github.connection"))[
      "github.connection"
    ] as { credential?: unknown } | undefined;
    return {
      initial,
      mismatched,
      idle,
      cleared,
      disconnected,
      after,
      credential: connection?.credential,
      pending: await chrome.storage.session.get("github.pending"),
    };
  });

  assert.equal(settingsState.initial.connected, false);

  assert.deepEqual(
    {
      state: settingsState.mismatched.state,
      code: settingsState.mismatched.code,
    },
    { state: "failed", code: "authentication_invalid" },
  );

  assert.equal(settingsState.idle.state, "idle");

  assert.equal(settingsState.cleared.state, "cleared");

  assert.equal(settingsState.disconnected.state, "disconnected");

  assert.equal(settingsState.after.connected, false);

  assert.equal(settingsState.credential, undefined);

  assert.deepEqual(settingsState.pending, {});

  const rejectedPublicFromSettings = await settingsPage.evaluate(
    () =>
      new Promise<string>((resolve) =>
        chrome.runtime.sendMessage(
          {
            protocolVersion: 1,
            type: "analysis.request",
            requestId: crypto.randomUUID(),
            navigationId: crypto.randomUUID(),
            repository: { owner: "culverin", name: "bootstrap-fixture" },
          },
          () => resolve(chrome.runtime.lastError ? "rejected" : "handled"),
        ),
      ),
  );

  assert.equal(rejectedPublicFromSettings, "rejected");

  assert.equal(fixtures.archiveRequests, 5);
  return { ...state };
}
