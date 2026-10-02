import { inspectPackage } from "./support/package";
import { createBrowserSession, closeBrowserSession } from "./support/session";
import { scenario } from "./support/scenario";
import { runSetup } from "./scenarios/setup";
import { runDiagnostics } from "./scenarios/diagnostics";
export async function runDiagnosticSuite(directory: string): Promise<void> {
  console.log("Testing diagnostic artifact: " + directory);
  inspectPackage(directory, true);
  const session = await createBrowserSession(directory);
  try {
    const setup = await scenario("diagnostic setup", () => runSetup(session));
    const settingsPage = await session.context.newPage();
    await settingsPage.goto(`${setup.extensionUrl}/settings.html#storage`);
    await settingsPage
      .locator("#github-connection")
      .filter({ hasText: /\S/ })
      .waitFor({ state: "attached" });
    await scenario("archive and counter diagnostics", () =>
      runDiagnostics({ ...setup, settingsPage }),
    );
  } finally {
    await closeBrowserSession(session);
  }
}
