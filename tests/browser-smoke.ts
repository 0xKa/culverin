import { resolve } from "node:path";
import { inspectPackage } from "./browser/support/package";
import {
  createBrowserSession,
  closeBrowserSession,
} from "./browser/support/session";
import { runSetup } from "./browser/scenarios/setup";
import { runPagePopupLifetimes } from "./browser/scenarios/page-popup-lifetimes";
import { runPopupResults } from "./browser/scenarios/popup-results";
import { runIgnoreAccess } from "./browser/scenarios/ignore-access";
import { runPartialResults } from "./browser/scenarios/partial-results";
import { runAcquisitionLifetimes } from "./browser/scenarios/acquisition-lifetimes";
import { runLivePublic } from "./browser/scenarios/live-public";
import { runDiagnostics } from "./browser/scenarios/diagnostics";
import { runPageCounting } from "./browser/scenarios/page-counting";
import { runGithubStorage } from "./browser/scenarios/github-storage";

async function scenario<T>(name: string, run: () => Promise<T>): Promise<T> {
  console.log("Browser scenario: " + name);
  try {
    return await run();
  } catch (cause) {
    throw new Error("Browser scenario failed: " + name, { cause });
  }
}
const directory = resolve(
  process.env.CULVERIN_EXTENSION_DIR ?? "extension/dist",
);
inspectPackage(directory);
const session = await createBrowserSession(directory);
try {
  const step0 = await scenario("setup", () => runSetup(session));
  const step1 = await scenario("page-popup-lifetimes", () =>
    runPagePopupLifetimes(step0),
  );
  const step2 = await scenario("popup-results", () => runPopupResults(step1));
  const step3 = await scenario("ignore-access", () => runIgnoreAccess(step2));
  const step4 = await scenario("partial-results", () =>
    runPartialResults(step3),
  );
  const step5 = await scenario("acquisition-lifetimes", () =>
    runAcquisitionLifetimes(step4),
  );
  const step6 = await scenario("live-public", () => runLivePublic(step5));
  const step7 = await scenario("diagnostics", () => runDiagnostics(step6));
  const step8 = await scenario("page-counting", () => runPageCounting(step7));
  await scenario("github-storage", () => runGithubStorage(step8));
} finally {
  await closeBrowserSession(session);
}
