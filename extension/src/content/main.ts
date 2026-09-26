import { effectiveRulesHash } from "../counter/rules";
import {
  PUBLIC_PORT,
  validPublicReply,
  validSummaryUpdate,
  type PublicReply,
  type PublicRequest,
} from "../github/public-protocol";
import { pageContext, type PageRepository } from "./repository";
import { createSummaryUi, showTotalCodeLines, type SummaryUi } from "./ui";

type View = {
  url: string;
  navigationId: string;
  repository: PageRepository;
  ui: SummaryUi;
  lookupRequestId?: string;
  timer?: ReturnType<typeof setTimeout>;
  port: chrome.runtime.Port;
  messageListener: (
    message: unknown,
    sender: chrome.runtime.MessageSender,
  ) => void;
};

const WORKER_URL = chrome.runtime.getURL("background.js");
let view: View | undefined;
let scheduled: ReturnType<typeof setTimeout> | undefined;

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

async function lookup(current: View): Promise<void> {
  const { requestId, response } = send(current, "repository.lookup", {
    repository: current.repository,
  });
  current.lookupRequestId = requestId;
  const timer = setTimeout(() => {
    if (currentView(current) && current.lookupRequestId === requestId)
      current.lookupRequestId = undefined;
  }, 12_000);
  current.timer = timer;
  try {
    const reply = await response;
    if (
      !currentView(current) ||
      current.lookupRequestId !== requestId ||
      reply.type !== "repository.cache_hit"
    )
      return;
    const hash = await effectiveRulesHash([]);
    if (!currentView(current) || current.lookupRequestId !== requestId) return;
    showTotalCodeLines(
      current.ui,
      reply.result.engine.rulesHash === hash && reply.result.coverage.complete
        ? reply.result.totals.code
        : undefined,
    );
  } catch {
    if (currentView(current)) showTotalCodeLines(current.ui, undefined);
  } finally {
    clearTimeout(timer);
    if (current.lookupRequestId === requestId)
      current.lookupRequestId = undefined;
  }
}

function detach(): void {
  const current = view;
  if (!current) return;
  clearTimeout(current.timer);
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
  const ui = createSummaryUi();
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
  current.messageListener = (message, sender) => {
    if (
      sender.id !== chrome.runtime.id ||
      sender.url !== WORKER_URL ||
      sender.tab !== undefined ||
      !currentView(current) ||
      !validSummaryUpdate(message) ||
      message.repository.owner.toLowerCase() !==
        current.repository.owner.toLowerCase() ||
      message.repository.name.toLowerCase() !==
        current.repository.name.toLowerCase()
    )
      return;
    showTotalCodeLines(current.ui, message.totalCodeLines);
  };
  chrome.runtime.onMessage.addListener(current.messageListener);
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
