import { runAcquisitionLifetimes } from "./scenarios/acquisition-lifetimes";
import { runBranchCounting } from "./scenarios/branch-counting";
import { runGithubStorage } from "./scenarios/github-storage";
import { runIgnoreAccess } from "./scenarios/ignore-access";
import { runLivePublic } from "./scenarios/live-public";
import { runPageCounting } from "./scenarios/page-counting";
import { runPagePopupLifetimes } from "./scenarios/page-popup-lifetimes";
import { runPartialResults } from "./scenarios/partial-results";
import { runPopupResults } from "./scenarios/popup-results";
import { runStatusMarkMotion } from "./scenarios/status-mark";
import { runSetup } from "./scenarios/setup";
import { runAccentIcons } from "./scenarios/accent-icons";
import { runAboutVisibility } from "./scenarios/about-visibility";
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
    await scenario("accent icons", () => runAccentIcons(step0));
    await scenario("About visibility", () => runAboutVisibility(step0));
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
    const branches = await scenario("branch-counting", () =>
      runBranchCounting(step6),
    );
    const step7 = await scenario("page-counting", () =>
      runPageCounting(branches),
    );
    await scenario("github-storage", () => runGithubStorage(step7));
  } finally {
    await closeBrowserSession(session);
  }
}
