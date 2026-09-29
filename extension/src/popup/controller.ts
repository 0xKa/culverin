import { effectiveRulesHash, isDefaultIgnore } from "../counter/rules";
import { describeIgnore, readIgnore } from "../ignore/settings";
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
import type { AnalysisResultV2 } from "../counter/result";
import { RATE_LIMIT_KEY, validRateLimit } from "../github/rate-limit";
import { apiLimitView, resultView, sizesView } from "./view";
import type { PopupEvent } from "./state";
import { rememberSection, type SectionId } from "../settings/sections";

const navigationId = crypto.randomUUID();
let dispatch: (event: PopupEvent) => void = () => undefined;
const rulesChanged =
  "Culverin ignore changed. Reopen the popup to see results for the current rules.";
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
  dispatch({ type: "status", value });
}

function setBusy(busy: boolean): void {
  dispatch({ type: "busy", busy, disabled: busy || retryUntil > Date.now() });
}

function clearResult(): void {
  dispatch({ type: "clearResult" });
}

async function currentRulesHash(): Promise<string> {
  const ignore = await readIgnore();
  dispatch({
    type: "ignore",
    value: isDefaultIgnore(ignore)
      ? undefined
      : `Culverin ignore: ${describeIgnore(ignore)}`,
  });
  return effectiveRulesHash(ignore);
}

function showSizes(resolution: ResolutionEnvelope): void {
  dispatch({ type: "sizes", value: sizesView(resolution) });
}

function showResult(
  result: AnalysisResultV2,
  resolution: ResolutionEnvelope,
): void {
  dispatch({
    type: "result",
    value: resultView(result, resolution),
    sizes: sizesView(resolution),
  });
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
  dispatch({ type: "lookup" });
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
      await currentRulesHash();
      if (lookupRequestId !== pending.requestId) return;
      setStatus(
        `Ready to analyze ${reply.resolution.defaultBranch} at ${reply.resolution.sha.slice(0, 12)}. ${reply.rulesChanged ? "Culverin ignore changed since the last count." : "Analyze downloads a source snapshot from GitHub and counts it locally."}`,
      );
      void resume();
    } else if (reply.type === "repository.cache_hit") {
      const hash = await currentRulesHash();
      if (lookupRequestId !== pending.requestId) return;
      if (reply.result.engine.rulesHash !== hash) {
        clearResult();
        showSizes(reply.resolution);
        setStatus(rulesChanged);
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
    const hash = await currentRulesHash();
    if (activeRequestId !== requestId) return;
    if (reply.result.engine.rulesHash !== hash) {
      setStatus(rulesChanged);
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

export async function analyze(): Promise<void> {
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

export async function cancel(): Promise<void> {
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
  dispatch({ type: "left" });
}

function sameRepository(url: string, expected: PageRepository): boolean {
  const current = pageRepository(url);
  return Boolean(
    current &&
    current.owner.toLowerCase() === expected.owner.toLowerCase() &&
    current.name.toLowerCase() === expected.name.toLowerCase(),
  );
}

function onUpdated(tabId: number, changeInfo: { url?: string }): void {
  if (
    target &&
    tabId === target.tabId &&
    changeInfo.url &&
    !sameRepository(changeInfo.url, target.repository)
  )
    leaveRepository();
}

let apiLimitChanged = false;

function showApiLimit(value: unknown): void {
  dispatch({
    type: "apiLimit",
    value: validRateLimit(value) ? apiLimitView(value, Date.now()) : undefined,
  });
}

function onStorageChanged(
  changes: Record<string, chrome.storage.StorageChange>,
  area: string,
): void {
  if (area !== "session" || !(RATE_LIMIT_KEY in changes)) return;
  apiLimitChanged = true;
  showApiLimit(changes[RATE_LIMIT_KEY]!.newValue);
}

function onActivated({ tabId }: { tabId: number }): void {
  if (target && tabId !== target.tabId) leaveRepository();
}

export function openSettings(section?: SectionId): void {
  if (section) rememberSection(section);
  void chrome.runtime.openOptionsPage();
}

export function startPopup(
  dispatchView: (event: PopupEvent) => void,
): () => void {
  dispatch = dispatchView;
  chrome.tabs.onUpdated.addListener(onUpdated);
  chrome.tabs.onActivated.addListener(onActivated);
  chrome.storage.onChanged.addListener(onStorageChanged);
  void chrome.storage.session
    .get(RATE_LIMIT_KEY)
    .then((state) => {
      if (!apiLimitChanged) showApiLimit(state[RATE_LIMIT_KEY]);
    })
    .catch(() => undefined);
  void initialize();
  return () => {
    chrome.tabs.onUpdated.removeListener(onUpdated);
    chrome.tabs.onActivated.removeListener(onActivated);
    chrome.storage.onChanged.removeListener(onStorageChanged);
    clearTimeout(timer);
    clearTimeout(retryTimer);
    port?.disconnect();
    port = undefined;
    waiting.clear();
  };
}

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
    dispatch({
      type: "repository",
      value: `${repository.owner}/${repository.name}`,
    });
    await lookup();
  } catch {
    setStatus("Unable to read the active tab. Open a GitHub repository.");
  }
}
