import { effectiveRulesHash } from "../counter/rules";
import type { AnalysisResultV2 } from "../counter/result";
import { pageRepository, type PageRepository } from "../content/repository";
import { failureMessages } from "../github/failure-messages";
import {
  POPUP_PORT,
  validPublicReply,
  type PopupPublicRequest,
  type PublicErrorCode,
  type PublicReply,
  type PublicRequest,
  type ResolutionEnvelope,
} from "../github/public-protocol";
import { formatBytes } from "./size";

const navigationId = crypto.randomUUID();
const repositoryLabel = document.querySelector<HTMLElement>("#repository")!;
const status = document.querySelector<HTMLElement>("#status")!;
const analysis = document.querySelector<HTMLElement>("#analysis")!;
const codeLines = document.querySelector<HTMLElement>("#code-lines")!;
const metrics = document.querySelector<HTMLElement>("#metrics")!;
const sizes = document.querySelector<HTMLElement>("#sizes")!;
const repositorySize = document.querySelector<HTMLElement>("#repository-size")!;
const snapshotLabel = document.querySelector<HTMLElement>("#snapshot-label")!;
const snapshotSize = document.querySelector<HTMLElement>("#snapshot-size")!;
const analyzeButton = document.querySelector<HTMLButtonElement>("#analyze")!;
const cancelButton = document.querySelector<HTMLButtonElement>("#cancel")!;
const details = document.querySelector<HTMLDetailsElement>("#details")!;
const detailContent = document.querySelector<HTMLElement>("#detail-content")!;
const errors: Record<PublicErrorCode, string> = {
  ...failureMessages,
  analysis_interrupted: "Analysis was interrupted. Click Analyze to try again.",
  analysis_busy: "Analysis is busy. Select Analyze repository to retry.",
};

const progressText = {
  queued: "Queued for local analysis…",
  resolving: "Resolving repository revision…",
  downloading: "Downloading source snapshot from GitHub…",
  decompressing: "Decompressing and validating source snapshot…",
  counting: "Counting source files locally…",
};

let target: { tabId: number; repository: PageRepository } | undefined;
let port: chrome.runtime.Port | undefined;
const waiting = new Map<
  string,
  { resolve: (reply: PublicReply) => void; reject: (error: Error) => void }
>();
let lookupRequestId: string | undefined;
let activeRequestId: string | undefined;
let timer: ReturnType<typeof setTimeout> | undefined;
let retryTimer: ReturnType<typeof setTimeout> | undefined;
let retryUntil = 0;

function setStatus(value: string): void {
  if (status.textContent !== value) status.textContent = value;
}

function setBusy(busy: boolean): void {
  analyzeButton.disabled = busy || retryUntil > Date.now();
  cancelButton.hidden = !busy;
}

function clearResult(): void {
  details.hidden = true;
  details.open = false;
  detailContent.replaceChildren();
  codeLines.textContent = "";
  metrics.textContent = "";
  snapshotSize.textContent = "Available after analysis";
}

function showSizes(resolution: ResolutionEnvelope): void {
  repositorySize.textContent =
    resolution.sizeKb === null
      ? "Not reported"
      : formatBytes(resolution.sizeKb * 1024);
  snapshotLabel.textContent = `Files at ${resolution.sha.slice(0, 12)}`;
  sizes.hidden = false;
}

function paragraph(text: string, className?: string): HTMLParagraphElement {
  const value = document.createElement("p");
  value.textContent = text;
  if (className) value.className = className;
  return value;
}

function showResult(
  result: AnalysisResultV2,
  resolution: ResolutionEnvelope,
): void {
  const { totals, coverage, engine } = result;
  codeLines.textContent = `${totals.code.toLocaleString()} code lines`;
  metrics.textContent = `${totals.files.toLocaleString()} files · ${totals.lines.toLocaleString()} physical lines · ${totals.comments.toLocaleString()} comments · ${totals.blanks.toLocaleString()} blanks`;
  showSizes(resolution);
  snapshotSize.textContent = formatBytes(coverage.totalBytes);
  detailContent.replaceChildren(
    paragraph(
      `Default branch ${resolution.defaultBranch} · commit ${resolution.sha.slice(0, 12)}`,
    ),
    paragraph(
      `${engine.name} ${engine.version} · ${engine.rulesProfile} profile, rules ${engine.rulesVersion} · wrapper ${engine.wrapperVersion}`,
    ),
    paragraph(
      "Repository source was downloaded directly from GitHub and analyzed in your browser.",
    ),
  );
  const languages = document.createElement("ul");
  languages.setAttribute("aria-label", "Languages by code lines");
  for (const language of result.languages) {
    const item = document.createElement("li");
    const percent = totals.code === 0 ? 0 : (language.code / totals.code) * 100;
    item.textContent = `${language.language}: ${language.code.toLocaleString()} code lines (${percent.toFixed(1)}% of code lines), ${language.files.toLocaleString()} files`;
    languages.append(item);
  }
  if (result.languages.length) detailContent.append(languages);
  else detailContent.append(paragraph("No language totals."));
  const skipped = coverage.skippedByReason;
  detailContent.append(
    paragraph(
      `Source profile coverage: ${coverage.countedFiles.toLocaleString()} of ${coverage.regularFiles.toLocaleString()} regular files counted; ${coverage.skippedFiles.toLocaleString()} skipped (${skipped.excluded_by_rule.toLocaleString()} excluded by source profile, ${skipped.unsupported_language.toLocaleString()} unsupported language, ${skipped.binary_content.toLocaleString()} binary, ${skipped.oversized_source.toLocaleString()} oversized).`,
    ),
  );
  if (!coverage.complete) {
    detailContent.append(
      paragraph(
        `Partial analysis: ${coverage.incompleteReasons.map((reason) => (reason === "oversized_source" ? "some source files exceeded the safe size limit" : "some source counts may be inaccurate")).join("; ")}.`,
        "warning",
      ),
    );
  }
  details.hidden = false;
  details.open = true;
}

function handleFailure(
  reply: Extract<PublicReply, { type: "analysis.failed" }>,
): void {
  let message = errors[reply.code];
  if (reply.code === "rate_limited") {
    retryUntil =
      reply.retryAt && reply.retryAt > Date.now()
        ? reply.retryAt
        : Date.now() + 60_000;
    message += reply.retryAt
      ? ` Retry after ${new Date(reply.retryAt).toLocaleString()}.`
      : " Try again later.";
    clearTimeout(retryTimer);
    retryTimer = setTimeout(() => {
      retryUntil = 0;
      setBusy(Boolean(activeRequestId));
    }, retryUntil - Date.now());
  }
  setStatus(message);
  if (reply.code !== "rate_limited") retryUntil = 0;
  setBusy(Boolean(activeRequestId));
}

function receive(value: unknown): void {
  for (const [requestId, waiter] of waiting) {
    if (!validPublicReply(value, requestId, navigationId)) continue;
    if (value.type === "analysis.progress") break;
    waiting.delete(requestId);
    waiter.resolve(value);
    return;
  }
  const requestId = activeRequestId;
  if (!requestId || !validPublicReply(value, requestId, navigationId)) return;
  if (value.type === "analysis.progress") setStatus(progressText[value.phase]);
  else void finishAnalysis(requestId, value);
}

function connect(): chrome.runtime.Port {
  if (port) return port;
  const current = chrome.runtime.connect({ name: POPUP_PORT });
  current.onMessage.addListener(receive);
  current.onDisconnect.addListener(() => {
    if (port !== current) return;
    port = undefined;
    for (const waiter of waiting.values())
      waiter.reject(new Error("Extension disconnected"));
    waiting.clear();
    const requestId = activeRequestId;
    if (requestId) {
      setStatus(errors.analysis_interrupted);
      stopWatching(requestId);
    }
  });
  port = current;
  return current;
}

function send(
  type: PublicRequest["type"],
  extra: Record<string, unknown> = {},
): { requestId: string; response: Promise<PublicReply> } | undefined {
  if (!target) return undefined;
  const requestId = crypto.randomUUID();
  const request: PopupPublicRequest = {
    protocolVersion: 1,
    type,
    requestId,
    navigationId,
    tabId: target.tabId,
    ...extra,
  } as PopupPublicRequest;
  const response = new Promise<PublicReply>((resolve, reject) => {
    waiting.set(requestId, { resolve, reject });
    try {
      connect().postMessage(request);
    } catch {
      waiting.delete(requestId);
      reject(new Error("Extension unavailable"));
    }
  });
  return { requestId, response };
}

async function lookup(): Promise<void> {
  const pending = send("repository.lookup", {
    repository: target?.repository,
  });
  if (!pending) return;
  lookupRequestId = pending.requestId;
  analyzeButton.disabled = true;
  setStatus("Resolving default branch…");
  const lookupTimer = setTimeout(() => {
    if (lookupRequestId === pending.requestId) {
      lookupRequestId = undefined;
      setBusy(false);
      setStatus("GitHub did not respond in time. Reopen the popup to retry.");
    }
  }, 12_000);
  try {
    const reply = await pending.response;
    if (lookupRequestId !== pending.requestId) return;
    if (reply.type === "repository.cache_miss") {
      clearResult();
      showSizes(reply.resolution);
      setStatus(
        `Ready to analyze ${reply.resolution.defaultBranch} at ${reply.resolution.sha.slice(0, 12)}. Analyze downloads a source snapshot from GitHub and counts it locally.`,
      );
      void resume();
    } else if (reply.type === "repository.cache_hit") {
      const hash = await effectiveRulesHash([]);
      if (lookupRequestId !== pending.requestId) return;
      if (reply.result.engine.rulesHash !== hash) {
        clearResult();
        showSizes(reply.resolution);
        setStatus(errors.internal_error);
      } else {
        showResult(reply.result, reply.resolution);
        setStatus(
          "Cached local analysis. Public visibility metadata may be up to one minute old.",
        );
      }
    } else if (reply.type === "analysis.failed") handleFailure(reply);
    else setStatus(errors.internal_error);
  } catch {
    if (lookupRequestId === pending.requestId)
      setStatus("Extension unavailable. Reopen the popup to retry.");
  } finally {
    clearTimeout(lookupTimer);
    if (lookupRequestId === pending.requestId) {
      lookupRequestId = undefined;
      setBusy(Boolean(activeRequestId));
    }
  }
}

function watchAnalysis(requestId: string): void {
  activeRequestId = requestId;
  clearTimeout(timer);
  timer = setTimeout(() => {
    if (activeRequestId !== requestId) return;
    activeRequestId = undefined;
    setBusy(false);
    setStatus(errors.analysis_interrupted);
    const cancel = send("analysis.cancel", { targetRequestId: requestId });
    void cancel?.response.catch(() => undefined);
  }, 60_000);
}

function stopWatching(requestId: string): void {
  if (activeRequestId !== requestId) return;
  activeRequestId = undefined;
  clearTimeout(timer);
  setBusy(false);
}

async function finishAnalysis(
  requestId: string,
  reply: PublicReply,
): Promise<void> {
  if (activeRequestId !== requestId) return;
  if (reply.type === "analysis.completed") {
    const hash = await effectiveRulesHash([]);
    if (activeRequestId !== requestId) return;
    if (reply.result.engine.rulesHash !== hash) {
      setStatus(errors.internal_error);
    } else {
      showResult(reply.result, reply.resolution);
      setStatus(
        reply.fromCache
          ? "Cached local analysis. Public visibility metadata may be up to one minute old."
          : reply.result.coverage.complete
            ? "Analyzed locally."
            : "Partial local analysis.",
      );
    }
  } else if (reply.type === "analysis.failed") handleFailure(reply);
  else setStatus(errors.internal_error);
  stopWatching(requestId);
}

async function analyze(): Promise<void> {
  if (!target || activeRequestId || lookupRequestId) return;
  const pending = send("analysis.request", {
    repository: target.repository,
  });
  if (!pending) return;
  watchAnalysis(pending.requestId);
  setBusy(true);
  clearResult();
  setStatus("Resolving default branch…");
  try {
    await finishAnalysis(pending.requestId, await pending.response);
  } catch {
    if (activeRequestId === pending.requestId)
      setStatus(errors.analysis_interrupted);
    stopWatching(pending.requestId);
  }
}

async function resume(): Promise<void> {
  if (!target || activeRequestId) return;
  const pending = send("analysis.status");
  if (!pending) return;
  activeRequestId = pending.requestId;
  const reply = await pending.response.catch(() => undefined);
  if (activeRequestId !== pending.requestId) return;
  if (
    reply?.type === "analysis.status" &&
    (reply.state === "queued" || reply.state === "running")
  ) {
    watchAnalysis(pending.requestId);
    setBusy(true);
    clearResult();
    setStatus(
      reply.state === "queued"
        ? progressText.queued
        : "Analysis in progress. Closing the popup does not stop it.",
    );
    return;
  }
  stopWatching(pending.requestId);
}

async function cancel(): Promise<void> {
  const requestId = activeRequestId;
  if (!requestId) return;
  activeRequestId = undefined;
  clearTimeout(timer);
  setBusy(false);
  setStatus(errors.analysis_canceled);
  const pending = send("analysis.cancel", { targetRequestId: requestId });
  void pending?.response.catch(() => undefined);
}

function leaveRepository(): void {
  activeRequestId = undefined;
  lookupRequestId = undefined;
  target = undefined;
  clearTimeout(timer);
  clearTimeout(retryTimer);
  repositoryLabel.hidden = true;
  analysis.hidden = true;
  sizes.hidden = true;
  clearResult();
  setBusy(false);
  setStatus("The active tab changed. Reopen the popup to analyze it.");
}

function sameRepository(url: string, expected: PageRepository): boolean {
  const current = pageRepository(url);
  return Boolean(
    current &&
    current.owner.toLowerCase() === expected.owner.toLowerCase() &&
    current.name.toLowerCase() === expected.name.toLowerCase(),
  );
}

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (
    target &&
    tabId === target.tabId &&
    changeInfo.url &&
    !sameRepository(changeInfo.url, target.repository)
  )
    leaveRepository();
});

chrome.tabs.onActivated.addListener(({ tabId }) => {
  if (target && tabId !== target.tabId) leaveRepository();
});

document.querySelector("#settings")!.addEventListener("click", () => {
  void chrome.runtime.openOptionsPage();
});
analyzeButton.addEventListener("click", () => void analyze());
cancelButton.addEventListener("click", () => void cancel());

async function initialize(): Promise<void> {
  try {
    const [tab] = await chrome.tabs.query({
      active: true,
      currentWindow: true,
    });
    if (tab?.id === undefined || !tab.url) {
      setStatus("Open a GitHub repository overview to analyze it.");
      return;
    }
    const repository = pageRepository(tab.url);
    if (!repository) {
      setStatus("Open a GitHub repository overview to analyze it.");
      return;
    }
    target = { tabId: tab.id, repository };
    repositoryLabel.textContent = `${repository.owner}/${repository.name}`;
    repositoryLabel.hidden = false;
    analysis.hidden = false;
    await lookup();
  } catch {
    setStatus("Unable to read the active tab. Open a GitHub repository.");
  }
}

void initialize();
