import type { Fetcher } from "../github/client";
import { createPublicAnalysis } from "./analysis";
import { createAuthService } from "./auth";
import { createPopupJobs } from "./popup-jobs";
import { createBackgroundResources } from "./resources";
import { createSenderGates } from "./senders";
import { createSettingsHandler } from "./settings";
import { createPublicTransport } from "./transport";

export function createGitHubRuntime(
  browser: typeof chrome,
  fetcher: Fetcher = (input, init) => fetch(input, init),
) {
  const resources = createBackgroundResources(browser, fetcher);
  const chrome = browser;
  const { coordinator } = resources;
  const gates = createSenderGates({
    id: chrome.runtime.id,
    settingsUrl: chrome.runtime.getURL("settings.html"),
    popupUrl: chrome.runtime.getURL("popup.html"),
  });
  const auth = createAuthService(resources);
  const analysis = createPublicAnalysis(resources, auth);
  const popup = createPopupJobs(resources, analysis);
  const transport = createPublicTransport(resources, analysis, popup, gates);
  const settings = createSettingsHandler(resources, auth, gates);
  let initialized = false;
  function initialize(): void {
    if (initialized) return;
    initialized = true;
    transport.initialize();
    popup.initialize();
  }
  function handleArchiveCounting(
    message: unknown,
    sender: chrome.runtime.MessageSender,
  ): boolean {
    if (
      sender.id !== chrome.runtime.id ||
      sender.url !== chrome.runtime.getURL("offscreen.html") ||
      !message ||
      typeof message !== "object"
    )
      return false;
    const value = message as Record<string, unknown>;
    if (
      value.type !== "archive.counting" ||
      typeof value.requestId !== "string"
    )
      return false;
    return coordinator.reportCounting(value.requestId);
  }

  return {
    initialize,
    handleArchiveCounting,
    handleGithub: (
      value: unknown,
      sender: chrome.runtime.MessageSender,
      respond: (value: unknown) => void,
    ) =>
      transport.handle(value, sender, respond) ||
      settings.handle(value, sender, respond),
  };
}
let runtime: ReturnType<typeof createGitHubRuntime> | undefined;
export function initializeGitHub(): void {
  runtime ??= createGitHubRuntime(chrome);
  runtime.initialize();
}
export function handleGithub(
  value: unknown,
  sender: chrome.runtime.MessageSender,
  respond: (value: unknown) => void,
): boolean {
  return runtime?.handleGithub(value, sender, respond) ?? false;
}
export function handleArchiveCounting(
  value: unknown,
  sender: chrome.runtime.MessageSender,
): boolean {
  return runtime?.handleArchiveCounting(value, sender) ?? false;
}
