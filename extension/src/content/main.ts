import { defaultIgnore, effectiveRulesHash } from "../counter/rules";
import {
  PUBLIC_PORT,
  validPublicReply,
  validSummaryUpdate,
  type PublicReply,
  type PublicRequest,
} from "../github/public-protocol";
import { failureMessages } from "../github/failure-messages";
import { pageContext, type PageRepository } from "./repository";
import {
  createSummaryUi,
  failureState,
  lookupFailureState,
  partialState,
  showState,
  type RowAction,
  type RowState,
  type SummaryUi,
} from "./ui";

type View = {
  url: string;
  navigationId: string;
  repository: PageRepository;
  ui: SummaryUi;
  lookupRequestId?: string;
  analysisRequestId?: string;
  timer?: ReturnType<typeof setTimeout>;
  analysisTimer?: ReturnType<typeof setTimeout>;
  retryTimer?: ReturnType<typeof setTimeout>;
  port: chrome.runtime.Port;
  messageListener: (
    message: unknown,
    sender: chrome.runtime.MessageSender,
  ) => void;
};

const WORKER_URL = chrome.runtime.getURL("background.js");
let view: View | undefined;
let scheduled: ReturnType<typeof setTimeout> | undefined;
let hydration: { app: Element; stop: () => void } | undefined;
const hydrated = new WeakSet<Element>();

function routeUrl(): string {
  return location.origin + location.pathname + location.search;
}

function currentView(candidate: View): boolean {
  return view === candidate && candidate.url === routeUrl();
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

function setState(current: View, state: RowState): void {
  clearTimeout(current.retryTimer);
  showState(current.ui, state);
}

function rateLimit(current: View, retryAt?: number): void {
  setState(current, failureState("rate_limited", retryAt));
  const until = retryAt && retryAt > Date.now() ? retryAt : Date.now() + 60_000;
  current.retryTimer = setTimeout(() => {
    if (currentView(current) && !current.analysisRequestId)
      setState(current, { kind: "idle" });
  }, until - Date.now());
}

const defaultRulesHash = effectiveRulesHash(defaultIgnore);

async function completeState(
  result: Extract<PublicReply, { type: "repository.cache_hit" }>["result"],
): Promise<RowState> {
  return {
    kind: "complete",
    total: result.totals.code,
    customIgnore: result.engine.rulesHash !== (await defaultRulesHash),
  };
}

async function lookup(current: View): Promise<void> {
  const { requestId, response } = send(current, "repository.lookup", {
    repository: current.repository,
  });
  current.lookupRequestId = requestId;
  const active = () =>
    currentView(current) &&
    current.lookupRequestId === requestId &&
    !current.analysisRequestId;
  const timer = setTimeout(() => {
    if (active()) {
      current.lookupRequestId = undefined;
      setState(current, { kind: "idle" });
    }
  }, 12_000);
  current.timer = timer;
  try {
    const reply = await response;
    if (!active()) return;
    if (reply.type === "analysis.failed") {
      if (reply.code === "rate_limited") rateLimit(current, reply.retryAt);
      else setState(current, lookupFailureState(reply.code));
      return;
    }
    if (reply.type !== "repository.cache_hit") {
      setState(current, { kind: "idle" });
      return;
    }
    const state = reply.result.coverage.complete
      ? await completeState(reply.result)
      : undefined;
    if (!active()) return;
    setState(current, state ?? { kind: "idle" });
  } catch {
    if (active()) setState(current, { kind: "idle" });
  } finally {
    clearTimeout(timer);
    if (current.lookupRequestId === requestId)
      current.lookupRequestId = undefined;
  }
}

function stopAnalysis(current: View, requestId: string): boolean {
  if (current.analysisRequestId !== requestId) return false;
  current.analysisRequestId = undefined;
  clearTimeout(current.analysisTimer);
  return true;
}

async function finishAnalysis(
  current: View,
  requestId: string,
  reply: PublicReply,
): Promise<void> {
  if (!currentView(current) || current.analysisRequestId !== requestId) return;
  if (reply.type === "analysis.completed") {
    const state = await completeState(reply.result);
    if (!currentView(current) || !stopAnalysis(current, requestId)) return;
    if (!reply.result.coverage.complete)
      setState(current, partialState(reply.result.coverage.incompleteReasons));
    else setState(current, state);
    return;
  }
  stopAnalysis(current, requestId);
  if (reply.type !== "analysis.failed")
    setState(current, {
      kind: "retry",
      detail: failureMessages.internal_error,
    });
  else if (reply.code === "rate_limited") rateLimit(current, reply.retryAt);
  else setState(current, failureState(reply.code, reply.retryAt));
}

async function analyze(current: View): Promise<void> {
  if (current.analysisRequestId) return;
  const { requestId, response } = send(current, "analysis.request", {
    repository: current.repository,
  });
  current.lookupRequestId = undefined;
  current.analysisRequestId = requestId;
  setState(current, { kind: "running", phase: "resolving" });
  current.analysisTimer = setTimeout(() => {
    if (!currentView(current) || !stopAnalysis(current, requestId)) return;
    setState(current, failureState("analysis_interrupted"));
    void send(current, "analysis.cancel", {
      targetRequestId: requestId,
    }).response.catch(() => undefined);
  }, 60_000);
  try {
    await finishAnalysis(current, requestId, await response);
  } catch {
    if (currentView(current) && stopAnalysis(current, requestId))
      setState(current, failureState("analysis_interrupted"));
  }
}

function cancel(current: View): void {
  const requestId = current.analysisRequestId;
  if (!requestId || !stopAnalysis(current, requestId)) return;
  setState(current, { kind: "idle" });
  void send(current, "analysis.cancel", {
    targetRequestId: requestId,
  }).response.catch(() => undefined);
}

function activate(current: View, action: RowAction): void {
  if (!currentView(current)) return;
  if (action === "cancel") cancel(current);
  else if (action === "details")
    void send(current, "popup.open").response.catch(() => undefined);
  else void analyze(current);
}

function detach(): void {
  const current = view;
  if (!current) return;
  clearTimeout(current.timer);
  clearTimeout(current.analysisTimer);
  clearTimeout(current.retryTimer);
  stopHydration();
  current.port.disconnect();
  chrome.runtime.onMessage.removeListener(current.messageListener);
  current.ui.host.remove();
  view = undefined;
}

function create(repository: PageRepository): View {
  const current: View = {
    url: routeUrl(),
    navigationId: crypto.randomUUID(),
    repository,
    ui: createSummaryUi((action) => activate(current, action)),
    port: chrome.runtime.connect({ name: PUBLIC_PORT }),
    messageListener: () => undefined,
  };
  current.messageListener = (message, sender) => {
    if (
      sender.id !== chrome.runtime.id ||
      sender.url !== WORKER_URL ||
      sender.tab !== undefined ||
      !currentView(current)
    )
      return;
    const requestId = current.analysisRequestId;
    if (
      requestId &&
      validPublicReply(message, requestId, current.navigationId) &&
      message.type === "analysis.progress"
    ) {
      setState(current, { kind: "running", phase: message.phase });
      return;
    }
    if (
      !validSummaryUpdate(message) ||
      message.repository.owner.toLowerCase() !==
        current.repository.owner.toLowerCase() ||
      message.repository.name.toLowerCase() !==
        current.repository.name.toLowerCase()
    )
      return;
    if (requestId) stopAnalysis(current, requestId);
    current.lookupRequestId = undefined;
    setState(current, {
      kind: "complete",
      total: message.totalCodeLines,
      customIgnore: message.customIgnore,
    });
  };
  chrome.runtime.onMessage.addListener(current.messageListener);
  return current;
}

function mount(): void {
  if (view && view.url !== routeUrl()) detach();
  const context = pageContext(location.href, document);
  if (!context) return;
  if (!view) {
    view = create(context.repository);
    void lookup(view);
  }
  if (context.hydrating && !hydrated.has(context.hydrating)) {
    awaitHydration(context.hydrating);
    return;
  }
  if (context.anchor && view.ui.host.previousElementSibling !== context.anchor)
    context.anchor.after(view.ui.host);
}

function stopHydration(): void {
  hydration?.stop();
  hydration = undefined;
}

function awaitHydration(app: Element): void {
  if (hydration?.app === app) return;
  stopHydration();
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const settle = () => {
    hydrated.add(app);
    stopHydration();
    mount();
  };
  const observer = new MutationObserver(() => {
    if (app.classList.contains("loaded")) settle();
  });
  observer.observe(app, { attributes: true, attributeFilter: ["class"] });
  const fallback = () => {
    timer = setTimeout(settle, 2000);
  };
  if (document.readyState === "complete") fallback();
  else
    window.addEventListener("load", fallback, {
      once: true,
      signal: controller.signal,
    });
  hydration = {
    app,
    stop: () => {
      observer.disconnect();
      controller.abort();
      clearTimeout(timer);
    },
  };
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

new MutationObserver(() => {
  if (document.readyState === "loading" && !view?.ui.host.isConnected) mount();
  else schedule();
}).observe(document, {
  childList: true,
  subtree: true,
});
window.addEventListener("popstate", schedule);
window.addEventListener("pageshow", schedule);
window.addEventListener("resize", schedule);
window.addEventListener("pagehide", detach);
mount();
