import { effectiveRulesHash } from "../counter/rules";
import {
  PUBLIC_PORT,
  validPublicReply,
  type PublicErrorCode,
  type PublicReply,
  type PublicRequest,
} from "../github/public-protocol";
import { pageRepository, type PageRepository } from "./repository";

type View = {
  url: string;
  navigationId: string;
  repository: PageRepository;
  root: HTMLElement;
  status: HTMLElement;
  result: HTMLElement;
  analyze: HTMLButtonElement;
  cancel: HTMLButtonElement;
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
  repository_unavailable: "Repository unavailable or access is restricted.",
  repository_empty: "This repository has no default-branch commit to analyze.",
  repository_forbidden: "Repository unavailable or access is restricted.",
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
  analysis_busy: "Another analysis is in progress. Try again later.",
  analysis_canceled: "Analysis canceled.",
  counter_failed: "Local counting failed.",
  internal_error: "Analysis failed. Try again.",
};

function element<K extends keyof HTMLElementTagNameMap>(
  name: K,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(name);
  if (text !== undefined) node.textContent = text;
  return node;
}

function updateBusy(current: View, busy: boolean): void {
  current.analyze.disabled = busy || (current.retryUntil ?? 0) > Date.now();
  current.cancel.hidden = !busy;
}

function setStatus(current: View, text: string): void {
  current.status.textContent = text;
}

function currentView(candidate: View): boolean {
  return (
    view === candidate &&
    candidate.url === location.href &&
    candidate.root.isConnected
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
  current.result.replaceChildren();
}

function renderResult(
  current: View,
  reply: Extract<PublicReply, { type: "analysis.completed" }>,
): void {
  const { result, resolution } = reply;
  current.result.replaceChildren();
  const totals = result.totals;
  current.result.append(
    element("p", `${totals.code} code lines across ${totals.files} files`),
    element(
      "p",
      `${totals.lines} physical lines · ${totals.comments} comments · ${totals.blanks} blanks`,
    ),
    element(
      "p",
      `${resolution.defaultBranch} · ${resolution.sha.slice(0, 12)} · ${result.engine.name} ${result.engine.version}`,
    ),
  );
  const list = element("ul");
  for (const language of result.languages) {
    const percent = totals.code === 0 ? 0 : (language.code / totals.code) * 100;
    list.append(
      element(
        "li",
        `${language.language}: ${language.code} code lines (${percent.toFixed(1)}% of code lines), ${language.files} files`,
      ),
    );
  }
  current.result.append(list);
  const skipped = result.coverage.skippedByReason;
  current.result.append(
    element(
      "p",
      `Skipped regular files: ${result.coverage.skippedFiles} (${skipped.excluded_by_rule} excluded, ${skipped.unsupported_language} unsupported, ${skipped.binary_content} binary, ${skipped.oversized_source} oversized).`,
    ),
  );
  if (!result.coverage.complete)
    current.result.append(
      element(
        "p",
        `Partial analysis: ${result.coverage.incompleteReasons.map((reason) => (reason === "oversized_source" ? "some source files exceeded the safe size limit" : "some source counts may be inaccurate")).join("; ")}.`,
      ),
    );
  setStatus(
    current,
    result.coverage.complete ? "Analyzed locally." : "Partial local analysis.",
  );
}

async function lookup(current: View): Promise<void> {
  const { requestId, response } = send(current, "repository.lookup", {
    repository: current.repository,
  });
  current.lookupRequestId = requestId;
  current.analyze.disabled = true;
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
    else if (reply.type === "analysis.failed") showFailure(current, reply);
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
  current.result.replaceChildren();
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
  }, 30_000);
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
  current.root.remove();
  view = undefined;
}

function mount(): void {
  const repository = pageRepository(location.href);
  const repositoryMarker =
    document.querySelector("#repository-container-header") ??
    document.querySelector(
      'meta[name="octolytics-dimension-repository_id"][content]',
    );
  if (!repository || !repositoryMarker) {
    detach();
    return;
  }
  if (view?.url === location.href && view.root.isConnected) return;
  detach();
  const root = element("section");
  root.dataset.culverinRoot = "";
  root.setAttribute("aria-label", "Culverin repository analysis");
  root.style.cssText =
    "margin:16px 0;padding:12px;border:1px solid currentColor;border-radius:6px;max-width:720px";
  const title = element("h2", "Culverin");
  title.style.cssText = "font-size:16px;margin:0 0 8px";
  const analyzeButton = element("button", "Analyze repository");
  analyzeButton.type = "button";
  const cancelButton = element("button", "Cancel");
  cancelButton.type = "button";
  cancelButton.hidden = true;
  cancelButton.style.marginLeft = "8px";
  const status = element("p", "Ready to analyze.");
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");
  const result = element("div");
  root.append(title, analyzeButton, cancelButton, status, result);
  const anchor =
    document.querySelector("#repository-container-header") ??
    document.querySelector("main") ??
    document.body;
  anchor.prepend(root);
  const current: View = {
    url: location.href,
    navigationId: crypto.randomUUID(),
    repository,
    root,
    status,
    result,
    analyze: analyzeButton,
    cancel: cancelButton,
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
    if (message.type === "analysis.progress")
      setStatus(
        current,
        message.phase === "downloading"
          ? `Downloading ${message.processedBytes ?? 0} bytes…`
          : `${message.phase[0]!.toUpperCase()}${message.phase.slice(1)}…`,
      );
  };
  chrome.runtime.onMessage.addListener(current.messageListener);
  analyzeButton.addEventListener("click", () => void analyze(current));
  cancelButton.addEventListener("click", () => cancel(current));
  void lookup(current);
}

function schedule(): void {
  if (scheduled) return;
  scheduled = setTimeout(() => {
    scheduled = undefined;
    mount();
  }, 80);
}

new MutationObserver(schedule).observe(document.documentElement, {
  childList: true,
  subtree: true,
});
window.addEventListener("popstate", schedule);
window.addEventListener("pageshow", schedule);
window.addEventListener("pagehide", detach);
schedule();
