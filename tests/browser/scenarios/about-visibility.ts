import assert from "node:assert/strict";
import type { runSetup } from "./setup";

export async function runAboutVisibility(
  state: Awaited<ReturnType<typeof runSetup>>,
): Promise<void> {
  const { context, page, summary, extensionUrl, fixtures, openPopup } = state;
  const settings = await context.newPage();
  await settings.goto(`${extensionUrl}/settings.html#repository-page`);
  const choice = settings.getByRole("radiogroup", {
    name: "Repo About section visibility",
  });
  await choice.locator("input:checked").waitFor();
  const checkedValue = () =>
    choice.locator("input:checked").getAttribute("value");
  const before = [fixtures.apiRequests, fixtures.archiveRequests];
  const setPrivacy = async (isPrivate: boolean) => {
    await page.evaluate((isPrivate) => {
      document
        .querySelector('meta[name="octolytics-dimension-repository_public"]')!
        .setAttribute("content", String(!isPrivate));
    }, isPrivate);
  };
  const change = async (value: string) => {
    await choice.locator(`input[value="${value}"]`).check();
    await settings.waitForFunction(async (value) => {
      const stored = await chrome.storage.sync.get("culverin.aboutVisibility");
      return (stored["culverin.aboutVisibility"] ?? "all") === value;
    }, value);
    await page.bringToFront();
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  };
  try {
    assert.equal(await checkedValue(), "all");
    assert.deepEqual(
      await choice
        .locator('input[name="about-visibility"]')
        .evaluateAll((options) =>
          options.map((option) => (option as HTMLInputElement).value),
        ),
      ["all", "public", "none"],
    );
    await change("none");
    await summary.waitFor({ state: "hidden" });
    const popup = await openPopup(page);
    await popup.getByRole("button", { name: "Analyze repository" }).waitFor();
    await popup.close();
    await change("all");
    await page.getByText("Analyze with Culverin").waitFor();
    await setPrivacy(true);
    await change("public");
    await summary.waitFor({ state: "hidden" });
    await settings.reload();
    await choice.locator("input:checked").waitFor();
    assert.equal(await checkedValue(), "public");
    await setPrivacy(false);
    await page.getByText("Analyze with Culverin").waitFor();
    await setPrivacy(true);
    await summary.waitFor({ state: "hidden" });
    await change("all");
    await page.getByText("Analyze with Culverin").waitFor();
    assert.deepEqual([fixtures.apiRequests, fixtures.archiveRequests], before);
  } finally {
    await settings.evaluate(() =>
      chrome.storage.sync.remove("culverin.aboutVisibility"),
    );
    await setPrivacy(false);
    await page.reload();
    await page.getByText("Analyze with Culverin").waitFor();
    await settings.close();
  }
}
