import { effectiveRulesHash, isDefaultIgnore } from "../counter/rules";
import { describeIgnore, readIgnore } from "../ignore/settings";
import {
  pageRepository,
  sameRepository,
  type PageRepository,
} from "../github/repository";
import { failureMessages, limitNote } from "../github/failure-messages";
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
import { subscribeRateLimit } from "../github/rate-limit-observer";
import { apiLimitView, resultView } from "./view";
import type { PopupEvent } from "./state";
import {
  failureStatus,
  progressStatuses,
  readyStatus,
  statuses,
  type PopupStatus,
} from "./status";
import { defaultNumberFormats, formatClockTime } from "../ui/format";
import { rememberSection, type SectionId } from "../settings/sections";
import { subscribeNumberFormats } from "../appearance/numbers";

const errors: Record<PublicErrorCode, string> = {
  ...failureMessages,
  analysis_interrupted: "Analysis was interrupted. Click Analyze to try again.",
  analysis_busy: "Analysis is busy. Select Analyze repository to retry.",
};

const connectLabels: Partial<Record<PublicErrorCode, string>> = {
  authentication_required: "Connect GitHub",
  authentication_invalid: "Connect GitHub",
  access_not_granted: "Check GitHub access",
};

export function createPopupController(
  dispatchView: (event: PopupEvent) => void,
) {
  const navigationId = crypto.randomUUID();
  let disposed = false;
  let started = false;
  let stopRateLimit: (() => void) | undefined;
  let stopNumberFormats: (() => void) | undefined;
  let formats = defaultNumberFormats;
  let shownResult:
    { result: AnalysisResultV2; resolution: ResolutionEnvelope } | undefined;
  const dispatch = (event: PopupEvent) => {
    if (!disposed) dispatchView(event);
  };
  let target: { tabId: number; repository: PageRepository } | undefined;
  let port: chrome.runtime.Port | undefined;
  const waiting = new Map<
    string,
    { resolve: (reply: PublicReply) => void; reject: (error: Error) => void }
  >();
  let lookupRequestId: string | undefined;
  let activeRequestId: string | undefined;
  let shownSha: string | undefined;
  let reanalyzedSha: string | undefined;
  let retryTimer: ReturnType<typeof setTimeout> | undefined;
  let retryUntil = 0;
  let shownStatus: PopupStatus | undefined;

  function setStatus(value: PopupStatus): void {
    shownStatus = value;
    dispatch({ type: "status", value });
  }

  function fail(code: PublicErrorCode): void {
    setStatus(failureStatus(code, errors[code]));
  }

  function setBusy(busy: boolean): void {
    dispatch({ type: "busy", busy, disabled: busy || retryUntil > Date.now() });
  }

  function clearResult(): void {
    shownSha = undefined;
    shownResult = undefined;
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

  function showResult(
    result: AnalysisResultV2,
    resolution: ResolutionEnvelope,
  ): void {
    shownSha = resolution.sha;
    shownResult = { result, resolution };
    dispatch({
      type: "result",
      value: resultView(result, resolution, formats),
    });
  }

  function handleFailure(
    reply: Extract<PublicReply, { type: "analysis.failed" }>,
  ): void {
    let message = errors[reply.code] + limitNote(reply.limit);
    dispatch({ type: "connect", label: connectLabels[reply.code] });
    if (reply.code !== "rate_limited") {
      retryUntil = 0;
      setStatus(
        failureStatus(
          reply.code,
          message,
          reply.code === "archive_throttled"
            ? "Try again in a minute"
            : undefined,
        ),
      );
      setBusy(Boolean(activeRequestId));
      return;
    }
    retryUntil =
      reply.retryAt && reply.retryAt > Date.now()
        ? reply.retryAt
        : Date.now() + 60_000;
    message += reply.retryAt
      ? ` Retry after ${new Date(reply.retryAt).toLocaleString()}.`
      : " Try again later.";
    const limited = failureStatus(
      reply.code,
      message,
      `Available at ${formatClockTime(retryUntil)}`,
    );
    setStatus(limited);
    clearTimeout(retryTimer);
    retryTimer = setTimeout(() => {
      retryUntil = 0;
      if (shownStatus === limited) setStatus({ ...limited, note: undefined });
      setBusy(Boolean(activeRequestId));
    }, retryUntil - Date.now());
    setBusy(Boolean(activeRequestId));
  }

  function receive(value: unknown): void {
    if (disposed) return;
    for (const [requestId, waiter] of waiting) {
      if (!validPublicReply(value, requestId, navigationId)) continue;
      if (value.type === "analysis.progress") break;
      waiting.delete(requestId);
      waiter.resolve(value);
      return;
    }
    const requestId = activeRequestId;
    if (!requestId || !validPublicReply(value, requestId, navigationId)) return;
    if (value.type === "analysis.progress")
      setStatus(
        value.phase === "resolving" && reanalyzedSha
          ? statuses.checkingUpdates
          : progressStatuses[value.phase],
      );
    else void finishAnalysis(requestId, value);
  }

  function connect(): chrome.runtime.Port {
    if (disposed) throw new Error("Viewer disposed");
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
        fail("analysis_interrupted");
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
    if (disposed || !target) return undefined;
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
    setStatus(statuses.lookup);
    const lookupTimer = setTimeout(() => {
      if (lookupRequestId === pending.requestId) {
        lookupRequestId = undefined;
        setBusy(false);
        setStatus(statuses.lookupTimeout);
      }
    }, 12_000);
    try {
      const reply = await pending.response;
      if (lookupRequestId !== pending.requestId) return;
      if (reply.type === "repository.not_cached") {
        clearResult();
        await currentRulesHash();
        if (lookupRequestId !== pending.requestId) return;
        setStatus(statuses.notCounted);
        void resume();
      } else if (reply.type === "repository.cache_miss") {
        clearResult();
        await currentRulesHash();
        if (lookupRequestId !== pending.requestId) return;
        setStatus(readyStatus(reply.resolution, reply.rulesChanged === true));
        void resume();
      } else if (reply.type === "repository.cache_hit") {
        const hash = await currentRulesHash();
        if (lookupRequestId !== pending.requestId) return;
        if (reply.result.engine.rulesHash !== hash) {
          clearResult();
          setStatus(statuses.rulesChanged);
        } else {
          showResult(reply.result, reply.resolution);
          setStatus(statuses.cached);
        }
      } else if (reply.type === "analysis.failed") handleFailure(reply);
      else fail("internal_error");
    } catch {
      if (lookupRequestId === pending.requestId)
        setStatus(statuses.extensionUnavailable);
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
  }

  function stopWatching(requestId: string): void {
    if (activeRequestId !== requestId) return;
    activeRequestId = undefined;
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
        setStatus(statuses.rulesChanged);
      } else {
        showResult(reply.result, reply.resolution);
        setStatus(
          reply.fromCache && reply.resolution.sha === reanalyzedSha
            ? statuses.upToDate
            : reply.fromCache
              ? statuses.cached
              : reply.result.coverage.complete
                ? statuses.fresh
                : statuses.partial,
        );
      }
    } else if (reply.type === "analysis.failed") handleFailure(reply);
    else fail("internal_error");
    stopWatching(requestId);
  }

  async function analyze(reanalyze = false): Promise<void> {
    if (!target || activeRequestId || lookupRequestId) return;
    const pending = send("analysis.request", {
      repository: target.repository,
      ...(reanalyze ? { reanalyze: true } : {}),
    });
    reanalyzedSha = reanalyze ? shownSha : undefined;
    if (!pending) return;
    watchAnalysis(pending.requestId);
    setBusy(true);
    if (!reanalyze) clearResult();
    dispatch({ type: "connect" });
    setStatus(reanalyze ? statuses.checkingUpdates : statuses.resolving);
    try {
      await finishAnalysis(pending.requestId, await pending.response);
    } catch {
      if (activeRequestId === pending.requestId) fail("analysis_interrupted");
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
        reply.state === "queued" ? progressStatuses.queued : statuses.running,
      );
      return;
    }
    stopWatching(pending.requestId);
  }

  async function cancel(): Promise<void> {
    const requestId = activeRequestId;
    if (!requestId) return;
    activeRequestId = undefined;
    setBusy(false);
    fail("analysis_canceled");
    const pending = send("analysis.cancel", { targetRequestId: requestId });
    void pending?.response.catch(() => undefined);
  }

  function leaveRepository(): void {
    shownResult = undefined;
    activeRequestId = undefined;
    lookupRequestId = undefined;
    target = undefined;
    clearTimeout(retryTimer);
    dispatch({ type: "left" });
  }

  function onUpdated(tabId: number, changeInfo: { url?: string }): void {
    if (
      target &&
      tabId === target.tabId &&
      changeInfo.url &&
      !sameRepository(pageRepository(changeInfo.url), target.repository)
    )
      leaveRepository();
  }

  function onActivated({ tabId }: { tabId: number }): void {
    if (target && tabId !== target.tabId) leaveRepository();
  }

  function start(): void {
    if (started || disposed) return;
    started = true;
    chrome.tabs.onUpdated.addListener(onUpdated);
    chrome.tabs.onActivated.addListener(onActivated);
    stopRateLimit = subscribeRateLimit(({ value, now }) =>
      dispatch({
        type: "apiLimit",
        value: value ? apiLimitView(value, now) : undefined,
      }),
    );
    stopNumberFormats = subscribeNumberFormats((next) => {
      formats = next;
      if (shownResult) showResult(shownResult.result, shownResult.resolution);
    });
    void initialize();
  }

  function dispose(): void {
    if (disposed) return;
    disposed = true;
    activeRequestId = undefined;
    lookupRequestId = undefined;
    target = undefined;
    chrome.tabs.onUpdated.removeListener(onUpdated);
    chrome.tabs.onActivated.removeListener(onActivated);
    stopRateLimit?.();
    stopNumberFormats?.();
    shownResult = undefined;
    clearTimeout(retryTimer);
    for (const waiter of waiting.values())
      waiter.reject(new Error("Viewer disposed"));
    waiting.clear();
    port?.onMessage.removeListener(receive);
    port?.disconnect();
    port = undefined;
  }

  async function initialize(): Promise<void> {
    try {
      const [tab] = await chrome.tabs.query({
        active: true,
        currentWindow: true,
      });
      if (disposed) return;
      if (tab?.id === undefined || !tab.url) {
        setStatus(statuses.notRepository);
        return;
      }
      const repository = pageRepository(tab.url);
      if (!repository) {
        setStatus(statuses.notRepository);
        return;
      }
      target = { tabId: tab.id, repository };
      dispatch({
        type: "repository",
        value: `${repository.owner}/${repository.name}`,
      });
      await lookup();
    } catch {
      setStatus(statuses.tabUnreadable);
    }
  }

  return { start, analyze, cancel, dispose };
}

export function openSettings(section?: SectionId): void {
  if (section) rememberSection(section);
  void chrome.runtime.openOptionsPage();
}
