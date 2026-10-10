import { runAcquisitionLifetimes } from "./scenarios/acquisition-lifetimes";
import { runGithubStorage } from "./scenarios/github-storage";
import { runIgnoreAccess } from "./scenarios/ignore-access";
import { runLivePublic } from "./scenarios/live-public";
import { runPageCounting } from "./scenarios/page-counting";
import { runPagePopupLifetimes } from "./scenarios/page-popup-lifetimes";
import { runPartialResults } from "./scenarios/partial-results";
import { runPopupResults } from "./scenarios/popup-results";
import { runStatusMarkMotion } from "./scenarios/status-mark";
import { runSetup } from "./scenarios/setup";
import { inspectPackage } from "./support/package";
import { closeBrowserSession, createBrowserSession } from "./support/session";

import { runDeniedDiagnostics } from "./scenarios/denied-diagnostics";
import { scenario } from "./support/scenario";

export async function runProductSuite(directory: string): Promise<void> {
  console.log("Testing production artifact: " + directory);
  inspectPackage(directory);
  const session = await createBrowserSession(directory);
  try {
    const step0 = await scenario("setup", () => runSetup(session));
    await scenario("denied diagnostic capabilities", () =>
      runDeniedDiagnostics(step0),
    );
    await scenario("status mark motion", () => runStatusMarkMotion(session));
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
    const step7 = await scenario("page-counting", () => runPageCounting(step6));
    await scenario("github-storage", () => runGithubStorage(step7));
  } finally {
    await closeBrowserSession(session);
  }
}
