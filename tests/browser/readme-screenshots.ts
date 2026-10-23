import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { chromium, type Page } from "playwright";
import { createPopupControls } from "./support/action-popup";

const repositories = process.argv.slice(2);
const output = resolve(".bun/screenshots/real");
const schemes = ["light", "dark"] as const;

const profile = mkdtempSync(resolve(tmpdir(), "culverin-readme-"));
const packageCopy = resolve(profile, "extension");
cpSync(resolve("extension/dist"), packageCopy, { recursive: true });
writeFileSync(
  resolve(packageCopy, "test-harness.html"),
  "<!doctype html><title>Screenshots</title>",
);

const context = await chromium.launchPersistentContext(profile, {
  executablePath: process.env.CHROME_BIN || chromium.executablePath(),
  headless: true,
  deviceScaleFactor: 2,
  viewport: { width: 1280, height: 1000 },
  args: [
    "--headless=new",
    `--disable-extensions-except=${packageCopy}`,
    `--load-extension=${packageCopy}`,
  ],
});

async function aboutClip(page: Page) {
  const heading = page.getByRole("heading", { name: "About", exact: true });
  return heading.evaluate((element) => {
    let cell = element.parentElement;
    while (cell && !cell.textContent?.includes("Report repository"))
      cell = cell.parentElement;
    const rect = cell?.getBoundingClientRect();
    if (!rect) throw new Error("About sidebar not found");
    const pad = 16;
    const top = element.getBoundingClientRect().top - 12;
    return {
      x: rect.x - pad,
      y: top + window.scrollY,
      width: rect.width + pad * 2,
      height: rect.bottom + pad - top,
    };
  });
}

try {
  const worker =
    context.serviceWorkers()[0] ??
    (await context.waitForEvent("serviceworker"));
  const harness = await context.newPage();
  await harness.goto(
    `chrome-extension://${new URL(worker.url()).host}/test-harness.html`,
  );
  const { openPopup } = createPopupControls(context, harness, worker.url());

  for (const repository of repositories) {
    const name = repository.replace("/", "-");
    const directory = resolve(output, name);
    mkdirSync(directory, { recursive: true });
    const page = await context.newPage();
    await page.goto(`https://github.com/${repository}`);
    await page.getByText("Analyze with Culverin").waitFor({ timeout: 60_000 });
    const popup = await openPopup(page);
    await popup.setViewportSize({ width: 360, height: 1000 });
    const started = Date.now();
    await popup.getByRole("button", { name: "Analyze repository" }).click();
    await popup
      .getByRole("button", { name: "Reanalyze" })
      .waitFor({ timeout: 20 * 60_000 })
      .catch(async (error) => {
        await popup.screenshot({ path: resolve(directory, "failure.png") });
        throw error;
      });
    console.log(`${repository}: counted in ${Date.now() - started} ms`);
    await popup.mouse.move(0, 0);
    await popup.waitForTimeout(800);
    const rows = popup
      .getByRole("list", { name: "Languages by code lines" })
      .locator(":scope > li");
    const last = rows.nth(Math.min(await rows.count(), 8) - 1);
    const bottom = await last.evaluate(
      (row) => row.getBoundingClientRect().bottom,
    );
    const popupClip = { x: 0, y: 0, width: 360, height: bottom + 5 };
    for (const colorScheme of schemes) {
      await popup.emulateMedia({ colorScheme });
      await popup.waitForTimeout(300);
      await popup.screenshot({
        path: resolve(directory, `popup-${colorScheme}.png`),
        clip: popupClip,
      });
      await popup.screenshot({
        path: resolve(directory, `popup-full-${colorScheme}.png`),
        fullPage: true,
      });
    }

    await page.bringToFront();
    await page.getByText("lines of code").waitFor({ timeout: 60_000 });
    await page.waitForTimeout(800);
    for (const colorScheme of schemes) {
      await page.emulateMedia({ colorScheme });
      await page.waitForTimeout(500);
      await page.screenshot({
        path: resolve(directory, `about-${colorScheme}.png`),
        clip: await aboutClip(page),
      });
    }
    await page.evaluate(() => {
      const host = document.querySelector("[data-culverin-root]");
      const rows = Array.from(
        host?.shadowRoot?.querySelector("[aria-live]")?.children ?? [],
      );
      if (!rows.length) throw new Error("Culverin rows not found");
      const rects = rows.map((row) => row.getBoundingClientRect());
      const pad = 6;
      const left = Math.min(...rects.map((rect) => rect.left)) - pad;
      const top = Math.min(...rects.map((rect) => rect.top)) - pad + 5;
      const right = Math.max(...rects.map((rect) => rect.right)) + pad * 2;
      const bottom = Math.max(...rects.map((rect) => rect.bottom)) + pad + 5;
      const marker = document.createElement("div");
      marker.id = "culverin-readme-marker";
      Object.assign(marker.style, {
        position: "absolute",
        left: `${left + window.scrollX}px`,
        top: `${top + window.scrollY}px`,
        width: `${right - left}px`,
        height: `${bottom - top}px`,
        border: "2px solid #e5252a",
        boxSizing: "border-box",
        pointerEvents: "none",
        zIndex: "2147483647",
      });
      document.body.append(marker);
    });
    for (const colorScheme of schemes) {
      await page.emulateMedia({ colorScheme });
      await page.waitForTimeout(500);
      await page.screenshot({
        path: resolve(directory, `about-marked-${colorScheme}.png`),
        clip: await aboutClip(page),
      });
    }
    await popup.close();
    await page.close();
  }
} finally {
  await context.close();
  rmSync(profile, { recursive: true, force: true });
}
