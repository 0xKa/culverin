import { cpSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { chromium } from "playwright";
export async function createBrowserSession(directory: string) {
  const profile = mkdtempSync(resolve(tmpdir(), "culverin-browser-"));
  const packageCopy = resolve(profile, "extension");
  cpSync(directory, packageCopy, { recursive: true });
  writeFileSync(
    resolve(packageCopy, "test-harness.html"),
    "<!doctype html><title>Counter test</title>",
  );
  try {
    const context = await chromium.launchPersistentContext(profile, {
      executablePath: process.env.CHROME_BIN || chromium.executablePath(),
      headless: true,
      args: [
        "--headless=new",
        `--disable-extensions-except=${packageCopy}`,
        `--load-extension=${packageCopy}`,
      ],
    });

    return { context, profile, packageCopy, directory };
  } catch (error) {
    rmSync(profile, { recursive: true, force: true });
    throw error;
  }
}
export async function closeBrowserSession(
  session: Awaited<ReturnType<typeof createBrowserSession>>,
): Promise<void> {
  try {
    await session.context.close();
  } finally {
    rmSync(session.profile, { recursive: true, force: true });
  }
}
