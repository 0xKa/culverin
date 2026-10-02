import {
  POPUP_PORT,
  PUBLIC_PORT,
  validPublicRequest,
  type PublicReply,
  type PublicRequest,
} from "../github/public-protocol";
import type { createPublicAnalysis } from "./analysis";
import type { createPopupJobs } from "./popup-jobs";
import type { BackgroundResources } from "./resources";
import type { createSenderGates } from "./senders";
import { portKey, publicOwner, publicReply } from "./senders";

export function createPublicTransport(
  resources: BackgroundResources,
  analysis: ReturnType<typeof createPublicAnalysis>,
  popup: ReturnType<typeof createPopupJobs>,
  gates: ReturnType<typeof createSenderGates>,
) {
  const { chrome, coordinator, detachPending } = resources;
  const SETTINGS_URL = chrome.runtime.getURL("settings.html");
  const publicPorts = new Map<string, chrome.runtime.Port>();
  function publicProgress(
    tabId: number,
    documentId: string,
    request: PublicRequest,
    phase:
      "resolving" | "queued" | "downloading" | "decompressing" | "counting",
    processedBytes?: number,
  ): void {
    const message: PublicReply = {
      protocolVersion: 1,
      type: "analysis.progress",
      requestId: request.requestId,
      navigationId: request.navigationId,
      phase,
      ...(processedBytes === undefined ? {} : { processedBytes }),
    };
    void chrome.tabs
      .sendMessage(tabId, message, { documentId })
      .catch(() => undefined);
  }

  function handlePublic(
    value: unknown,
    sender: chrome.runtime.MessageSender,
    respond: (value: unknown) => void,
  ): boolean {
    const repository = gates.page(sender);
    if (
      !repository ||
      !validPublicRequest(value) ||
      sender.tab?.id === undefined ||
      !sender.documentId
    )
      return false;
    const request = value;
    const tabId = sender.tab.id;
    const documentId = sender.documentId;
    if (request.type === "popup.open") {
      const windowId = sender.tab.windowId;
      const opened = (value: boolean) =>
        respond(publicReply(request, { type: "popup.opened", opened: value }));
      if (!sender.tab.active || windowId === undefined) opened(false);
      else
        void chrome.action.openPopup({ windowId }).then(
          () => opened(true),
          () => opened(false),
        );
      return true;
    }
    if (request.type === "settings.open") {
      void chrome.tabs
        .create({ url: `${SETTINGS_URL}#github`, openerTabId: tabId })
        .then(
          () =>
            respond(
              publicReply(request, { type: "settings.opened", opened: true }),
            ),
          () =>
            respond(
              publicReply(request, { type: "settings.opened", opened: false }),
            ),
        );
      return true;
    }
    const key = portKey(tabId, documentId);
    const prefix = `p:${tabId}:${documentId}:`;
    analysis.run(request, {
      repository,
      owner: publicOwner(tabId, documentId, request.navigationId),
      prefix,
      page: true,
      isAlive: () => publicPorts.has(key),
      reply: (current, payload) => respond(publicReply(current, payload)),
      progress: (current, phase, processedBytes) =>
        publicProgress(tabId, documentId, current, phase, processedBytes),
    });
    return true;
  }

  function initialize(): void {
    chrome.runtime.onConnect.addListener((port) => {
      const sender = port.sender;
      if (port.name === POPUP_PORT) {
        if (!gates.popup(sender)) {
          port.disconnect();
          return;
        }
        popup.attach(port);
        return;
      }
      if (port.name === "culverin.options") {
        if (!sender || !gates.settings(sender) || !sender.documentId) {
          port.disconnect();
          return;
        }
        const prefix = `o:${sender.documentId}:`;
        port.onDisconnect.addListener(() => {
          coordinator.detachDocument(prefix);
          detachPending(prefix);
        });
        return;
      }
      if (
        port.name !== PUBLIC_PORT ||
        !sender ||
        !gates.page(sender) ||
        sender.tab?.id === undefined ||
        !sender.documentId
      ) {
        port.disconnect();
        return;
      }
      const key = portKey(sender.tab.id, sender.documentId);
      if (publicPorts.has(key)) {
        coordinator.detachDocument(`p:${sender.tab.id}:${sender.documentId}:`);
        detachPending(`p:${sender.tab.id}:${sender.documentId}:`);
      }
      publicPorts.set(key, port);
      port.onDisconnect.addListener(() => {
        if (publicPorts.get(key) !== port) return;
        publicPorts.delete(key);
        coordinator.detachDocument(`p:${sender.tab?.id}:${sender.documentId}:`);
        detachPending(`p:${sender.tab?.id}:${sender.documentId}:`);
      });
    });
  }

  return { handle: handlePublic, initialize };
}
