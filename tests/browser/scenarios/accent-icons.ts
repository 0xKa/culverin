import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { accent } from "../../../extension/src/appearance/accent";
import { toolbarIconPaths } from "../../../extension/src/appearance/icons";
import type { runSetup } from "./setup";

type IconScope = typeof globalThis & {
  originalSetIcon: typeof chrome.action.setIcon;
  nextIcon: Promise<{ path: unknown; error?: string }>;
  iconChanged: (result: { path: unknown; error?: string }) => void;
};

export async function runAccentIcons(
  state: Awaited<ReturnType<typeof runSetup>>,
): Promise<void> {
  const { context, fixtures, extensionUrl } = state;
  const before = [fixtures.apiRequests, fixtures.archiveRequests];
  const settings = await context.newPage();
  const popup = await context.newPage();
  await settings.goto(`${extensionUrl}/settings.html#appearance`);
  await settings.getByRole("radio", { name: /^Blue Default$/ }).waitFor();
  await popup.goto(`${extensionUrl}/popup.html`);
  const worker =
    context.serviceWorkers()[0] ??
    (await context.waitForEvent("serviceworker"));

  await worker.evaluate(() => {
    const scope = globalThis as IconScope;
    scope.originalSetIcon = chrome.action.setIcon.bind(chrome.action);
    chrome.action.setIcon = (async (details) => {
      try {
        await scope.originalSetIcon(details);
        scope.iconChanged?.({ path: details.path });
      } catch (error) {
        scope.iconChanged?.({ path: details.path, error: String(error) });
        throw error;
      }
    }) as typeof chrome.action.setIcon;
  });

  async function checkHeader(target: typeof settings, forced = false) {
    const colors = await target
      .locator("header .culverin-icon")
      .evaluate((element, forced) => {
        const probe = document.createElement("span");
        probe.style.backgroundColor = forced
          ? "CanvasText"
          : "var(--color-accent)";
        probe.style.forcedColorAdjust = "none";
        document.body.append(probe);
        const style = getComputedStyle(element);
        const colors = {
          actual: style.backgroundColor,
          expected: getComputedStyle(probe).backgroundColor,
          mask: style.maskImage,
          hidden: element.getAttribute("aria-hidden"),
        };
        probe.remove();
        return colors;
      }, forced);
    assert.equal(colors.actual, colors.expected);
    assert.notEqual(colors.mask, "none");
    assert.equal(colors.hidden, "true");
  }

  async function watchToolbarUpdate() {
    await worker.evaluate(() => {
      const scope = globalThis as IconScope;
      scope.nextIcon = new Promise((resolve) => {
        scope.iconChanged = resolve;
      });
    });
  }

  try {
    for (const oldValue of ["indigo", "violet"]) {
      await watchToolbarUpdate();
      await settings.evaluate(
        (oldValue) => chrome.storage.sync.set({ "culverin.accent": oldValue }),
        oldValue,
      );
      for (const target of [settings, popup])
        await target.waitForFunction(
          () => document.documentElement.dataset.accent === "purple",
        );
      const applied = await worker.evaluate(
        () => (globalThis as IconScope).nextIcon,
      );
      assert.deepEqual(applied, { path: toolbarIconPaths("purple") });
      await settings.evaluate(
        (oldValue) => localStorage.setItem("culverin.accent", oldValue),
        oldValue,
      );
      await settings.reload();
      await settings.waitForFunction(
        () =>
          localStorage.getItem("culverin.accent") === "purple" &&
          document.querySelector<HTMLInputElement>(
            'input[name="accent"][value="purple"]',
          )?.checked,
      );
      assert.equal(
        await settings
          .getByRole("radio", { name: "Purple", exact: true })
          .isChecked(),
        true,
      );
      await checkHeader(settings);
    }
    for (const value of [...accent.values.slice(1), accent.fallback]) {
      await watchToolbarUpdate();
      await settings.locator(`input[name="accent"][value="${value}"]`).check();
      for (const page of [settings, popup])
        await page.waitForFunction(
          (value) =>
            (document.documentElement.dataset.accent ?? "blue") === value,
          value,
        );
      const applied = await worker.evaluate(
        () => (globalThis as IconScope).nextIcon,
      );
      assert.deepEqual(applied, { path: toolbarIconPaths(value) });
      await checkHeader(settings);
      await checkHeader(popup);
    }

    await settings.getByRole("radio", { name: "Teal", exact: true }).check();
    await popup.waitForFunction(
      () => document.documentElement.dataset.accent === "teal",
    );
    for (const theme of ["light", "dark"] as const) {
      await settings.locator(`input[name="theme"][value="${theme}"]`).check();
      await popup.waitForFunction(
        (theme) => document.documentElement.dataset.theme === theme,
        theme,
      );
      for (const enabled of [false, true]) {
        await settings
          .locator(
            `input[name="high-contrast"][value="${enabled ? "high" : "standard"}"]`,
          )
          .check();
        await popup.waitForFunction(
          (enabled) =>
            (document.documentElement.dataset.contrast === "high") === enabled,
          enabled,
        );
        await checkHeader(settings);
        await checkHeader(popup);
      }
    }
    await settings
      .locator('input[name="high-contrast"][value="standard"]')
      .check();
    await popup.waitForFunction(
      () => !document.documentElement.dataset.contrast,
    );
    const output = resolve(".bun/screenshots/accent-icons");
    mkdirSync(output, { recursive: true });
    await settings.waitForTimeout(200);
    await settings.screenshot({
      path: resolve(output, "settings-teal-dark.png"),
    });
    await popup.screenshot({ path: resolve(output, "popup-teal-dark.png") });
    for (const target of [settings, popup]) {
      await target.emulateMedia({ forcedColors: "active" });
      await checkHeader(target, true);
      await target.emulateMedia({ forcedColors: "none" });
    }

    await settings.reload();
    await settings.waitForFunction(
      () => document.documentElement.dataset.accent === "teal",
    );
    assert.equal(
      await settings
        .getByRole("radio", { name: "Teal", exact: true })
        .isChecked(),
      true,
    );
    await checkHeader(settings);
    assert.deepEqual([fixtures.apiRequests, fixtures.archiveRequests], before);
  } finally {
    await worker.evaluate(() => {
      chrome.action.setIcon = (globalThis as IconScope).originalSetIcon;
    });
    await settings.locator('input[name="accent"][value="blue"]').check();
    await settings.locator('input[name="theme"][value="system"]').check();
    await settings
      .locator('input[name="high-contrast"][value="standard"]')
      .check();
    await popup.waitForFunction(
      () =>
        !document.documentElement.dataset.accent &&
        !document.documentElement.dataset.theme &&
        !document.documentElement.dataset.contrast,
    );
    await popup.close();
    await settings.close();
  }
}
