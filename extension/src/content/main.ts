import { effectiveRulesHash } from "../counter/rules";
import {
  PUBLIC_PORT,
  validPublicReply,
  type PublicErrorCode,
  type PublicReply,
  type PublicRequest,
} from "../github/public-protocol";
import { pageContext, type PageRepository } from "./repository";
import {
  clearAnalysisUi,
  createAnalysisUi,
  showAnalysisResult,
  type AnalysisUi,
} from "./ui";

type View = {
  url: string;
  navigationId: string;
  repository: PageRepository;
  ui: AnalysisUi;
  activeRequestId?: string;
  lookupRequestId?: string;
  timer?: ReturnType<typeof setTimeout>;
  retryTimer?: ReturnType<typeof setTimeout>;
  retryUntil?: number;
  port: chrome.runtime.Port;
  messageListener: (message: unknown) => void;
};

let view: View | undefined;
let scheduled: ReturnType<typeof setTimeout> | undefined;

const errorText: Record<PublicErrorCode, string> = {
  invalid_repository: "Invalid repository address.",
  unsupported_page: "This page is not supported.",
  repository_unavailable:
    "Repository unavailable or access is restricted. Organization approval or SSO may be required.",
  repository_empty: "This repository has no default-branch commit to analyze.",
  repository_forbidden:
    "Repository unavailable or access is restricted. Organization approval or SSO may be required.",
  rate_limited: "GitHub rate limit reached.",
  authentication_required: "Authentication is required for this repository.",
  authentication_invalid: "GitHub authentication is invalid.",
  metadata_limit_exceeded: "Repository metadata exceeds the safe limit.",
  network_unavailable: "GitHub could not be reached.",
  download_failed: "The source snapshot could not be downloaded.",
  compressed_limit_exceeded:
    "The source snapshot exceeds the compressed-size limit.",
  decompressed_limit_exceeded:
    "The source snapshot exceeds the expanded-size limit.",
  entry_limit_exceeded: "The source snapshot has too many entries.",
  file_limit_exceeded: "The source snapshot has too many files.",
  archive_invalid: "The source snapshot is malformed.",
  archive_unsupported: "This source snapshot format is unsupported.",
  analysis_timeout: "Analysis timed out. Try again.",
  analysis_interrupted: "Analysis was interrupted. Click Analyze to try again.",
  analysis_busy: "Analysis is busy. Select Analyze repository to retry.",
  analysis_canceled: "Analysis canceled.",
  counter_failed: "Local counting failed.",
  internal_error: "Analysis failed. Try again.",
};

function updateBusy(current: View, busy: boolean): void {
  current.ui.analyze.disabled = busy || (current.retryUntil ?? 0) > Date.now();
  current.ui.cancel.hidden = !busy;
}

function setStatus(current: View, text: string): void {
  if (current.ui.status.textContent !== text)
    current.ui.status.textContent = text;
}

function routeUrl(): string {
  return location.origin + location.pathname + location.search;
}

function currentView(candidate: View): boolean {
  return (
    view === candidate &&
    candidate.url === routeUrl() &&
    candidate.ui.host.isConnected
  );
}

function send(
  current: View,
  type: PublicRequest["type"],
  extra: Record<string, unknown> = {},
): { requestId: string; response: Promise<PublicReply> } {
  const requestId = crypto.randomUUID();
  const request = {
    protocolVersion: 1,
    type,
    requestId,
    navigationId: current.navigationId,
    ...extra,
  };
  const response = new Promise<PublicReply>((resolve, reject) => {
    chrome.runtime.sendMessage(request, (value: unknown) => {
      if (
        chrome.runtime.lastError ||
        !validPublicReply(value, requestId, current.navigationId)
      )
        reject(new Error("Invalid extension response"));
      else resolve(value);
    });
  });
  return { requestId, response };
}

function showFailure(
  current: View,
  reply: Extract<PublicReply, { type: "analysis.failed" }>,
): void {
  let message = errorText[reply.code];
  if (reply.code === "rate_limited" && reply.retryAt)
    message += ` Retry after ${new Date(reply.retryAt).toLocaleString()}.`;
  else if (reply.code === "rate_limited") message += " Try again later.";
  if (reply.code === "rate_limited") {
    current.retryUntil =
      reply.retryAt && reply.retryAt > Date.now()
        ? reply.retryAt
        : Date.now() + 60_000;
    clearTimeout(current.retryTimer);
    current.retryTimer = setTimeout(() => {
      current.retryUntil = undefined;
      if (currentView(current))
        updateBusy(current, Boolean(current.activeRequestId));
    }, current.retryUntil - Date.now());
    updateBusy(current, Boolean(current.activeRequestId));
  }
  setStatus(current, message);
  clearAnalysisUi(current.ui);
}

function renderResult(
  current: View,
  reply: Extract<
    PublicReply,
    { type: "analysis.completed" | "repository.cache_hit" }
  >,
): void {
  const { result, resolution } = reply;
  showAnalysisResult(current.ui, result, resolution);
  setStatus(
    current,
    reply.type === "repository.cache_hit" ||
      (reply.type === "analysis.completed" && reply.fromCache)
      ? "Cached local analysis. Public visibility metadata may be up to one minute old."
      : result.coverage.complete
        ? "Analyzed locally."
        : "Partial local analysis.",
  );
}

async function lookup(current: View): Promise<void> {
  const { requestId, response } = send(current, "repository.lookup", {
    repository: current.repository,
  });
  current.lookupRequestId = requestId;
  current.ui.analyze.disabled = true;
  setStatus(current, "Resolving default branch…");
  const timer = setTimeout(() => {
    if (currentView(current) && current.lookupRequestId === requestId) {
      current.lookupRequestId = undefined;
      updateBusy(current, false);
      setStatus(current, errorText.analysis_interrupted);
    }
  }, 12_000);
  try {
    const reply = await response;
    if (
      !currentView(current) ||
      current.activeRequestId ||
      current.lookupRequestId !== requestId
    )
      return;
    if (reply.type === "repository.cache_miss")
      setStatus(
        current,
        `Ready to analyze ${reply.resolution.defaultBranch} at ${reply.resolution.sha.slice(0, 12)}. Analysis downloads a source snapshot directly from GitHub and runs locally.`,
      );
    else if (reply.type === "repository.cache_hit") {
      const hash = await effectiveRulesHash([]);
      if (!currentView(current) || current.lookupRequestId !== requestId)
        return;
      if (reply.result.engine.rulesHash === hash) renderResult(current, reply);
      else setStatus(current, errorText.internal_error);
    } else if (reply.type === "analysis.failed") showFailure(current, reply);
  } catch {
    if (currentView(current) && current.lookupRequestId === requestId)
      setStatus(current, errorText.analysis_interrupted);
  } finally {
    clearTimeout(timer);
    if (current.lookupRequestId === requestId) {
      current.lookupRequestId = undefined;
      updateBusy(current, false);
    }
  }
}

async function analyze(current: View): Promise<void> {
  if (!currentView(current) || current.activeRequestId) return;
  const { requestId, response } = send(current, "analysis.request", {
    repository: current.repository,
  });
  current.activeRequestId = requestId;
  updateBusy(current, true);
  clearAnalysisUi(current.ui);
  setStatus(current, "Resolving default branch…");
  current.timer = setTimeout(() => {
    if (currentView(current) && current.activeRequestId === requestId) {
      current.activeRequestId = undefined;
      updateBusy(current, false);
      setStatus(current, errorText.analysis_interrupted);
      void send(current, "analysis.cancel", {
        targetRequestId: requestId,
      }).response.catch(() => undefined);
    }
  }, 60_000);
  try {
    const reply = await response;
    if (!currentView(current) || current.activeRequestId !== requestId) return;
    if (reply.type === "analysis.completed") {
      const hash = await effectiveRulesHash([]);
      if (!currentView(current) || current.activeRequestId !== requestId)
        return;
      if (reply.result.engine.rulesHash === hash) renderResult(current, reply);
      else setStatus(current, errorText.internal_error);
    } else if (reply.type === "analysis.failed") showFailure(current, reply);
    else setStatus(current, errorText.internal_error);
  } catch {
    if (currentView(current) && current.activeRequestId === requestId)
      setStatus(current, errorText.analysis_interrupted);
  } finally {
    if (current.activeRequestId === requestId) {
      current.activeRequestId = undefined;
      clearTimeout(current.timer);
      updateBusy(current, false);
    }
  }
}

function cancel(current: View): void {
  const targetRequestId = current.activeRequestId;
  if (!targetRequestId) return;
  current.activeRequestId = undefined;
  clearTimeout(current.timer);
  updateBusy(current, false);
  setStatus(current, errorText.analysis_canceled);
  void send(current, "analysis.cancel", { targetRequestId }).response.catch(
    () => undefined,
  );
}

function detach(): void {
  const current = view;
  if (!current) return;
  current.lookupRequestId = undefined;
  clearTimeout(current.retryTimer);
  cancel(current);
  current.port.disconnect();
  chrome.runtime.onMessage.removeListener(current.messageListener);
  current.ui.host.remove();
  view = undefined;
}

function mount(): void {
  const context = pageContext(location.href, document);
  if (!context) {
    detach();
    return;
  }
  if (
    view?.url === routeUrl() &&
    view.ui.host.isConnected &&
    view.ui.host.parentElement === context.anchor
  )
    return;
  detach();
  const ui = createAnalysisUi();
  context.anchor.prepend(ui.host);
  const current: View = {
    url: routeUrl(),
    navigationId: crypto.randomUUID(),
    repository: context.repository,
    ui,
    port: chrome.runtime.connect({ name: PUBLIC_PORT }),
    messageListener: () => undefined,
  };
  view = current;
  const watchPort = (port: chrome.runtime.Port) =>
    port.onDisconnect.addListener(() => {
      if (!currentView(current)) return;
      if (current.activeRequestId) {
        current.activeRequestId = undefined;
        clearTimeout(current.timer);
        updateBusy(current, false);
        setStatus(current, errorText.analysis_interrupted);
      }
      current.port = chrome.runtime.connect({ name: PUBLIC_PORT });
      watchPort(current.port);
    });
  watchPort(current.port);
  current.messageListener = (message: unknown) => {
    if (
      !currentView(current) ||
      !current.activeRequestId ||
      !validPublicReply(message, current.activeRequestId, current.navigationId)
    )
      return;
    if (message.type === "analysis.progress") {
      const status = {
        queued: "Queued for local analysis…",
        resolving: "Resolving repository revision…",
        downloading: "Downloading source snapshot from GitHub…",
        decompressing: "Decompressing and validating source snapshot…",
        counting: "Counting source files locally…",
      }[message.phase];
      setStatus(current, status);
    }
  };
  chrome.runtime.onMessage.addListener(current.messageListener);
  ui.analyze.addEventListener("click", () => void analyze(current));
  ui.cancel.addEventListener("click", () => cancel(current));
  void lookup(current);
}

function schedule(): void {
  if (scheduled) return;
  scheduled = setTimeout(() => {
    scheduled = undefined;
    mount();
  }, 80);
}

let observedRouteUrl = routeUrl();
setInterval(() => {
  const current = routeUrl();
  if (current !== observedRouteUrl) {
    observedRouteUrl = current;
    schedule();
  }
}, 150);

new MutationObserver(schedule).observe(document.documentElement, {
  childList: true,
  subtree: true,
});
window.addEventListener("popstate", schedule);
window.addEventListener("pageshow", schedule);
window.addEventListener("pagehide", detach);
schedule();
