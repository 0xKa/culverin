import {
  type PublicPayload,
  type PublicReply,
  type PublicRequest,
} from "../github/public-protocol";
import { pageRepository } from "../github/repository";
import { isPageUrl } from "./page-url";

export function publicOwner(
  tabId: number,
  documentId: string,
  navigationId: string,
): string {
  return `p:${tabId}:${documentId}:${navigationId}`;
}

export function optionsOwner(documentId: string, navigationId: string): string {
  return `o:${documentId}:${navigationId}`;
}

export function popupOwner(tabId: number, navigationId: string): string {
  return `u:${tabId}:${navigationId}`;
}

export function portKey(tabId: number, documentId: string): string {
  return `${tabId}:${documentId}`;
}

export function publicReply(
  request: PublicRequest,
  payload: PublicPayload,
): PublicReply {
  return {
    protocolVersion: 1,
    requestId: request.requestId,
    navigationId: request.navigationId,
    ...payload,
  } as PublicReply;
}

export function createSenderGates(identity: {
  id: string;
  settingsUrl: string;
  popupUrl: string;
}) {
  const chrome = { runtime: { id: identity.id } };
  function senderRepository(
    sender: chrome.runtime.MessageSender,
  ): { owner: string; name: string } | undefined {
    if (
      sender.id !== chrome.runtime.id ||
      sender.frameId !== 0 ||
      !Number.isSafeInteger(sender.tab?.id) ||
      (sender.tab?.id ?? -1) < 0 ||
      typeof sender.documentId !== "string" ||
      !sender.url ||
      !sender.tab?.url
    )
      return undefined;
    let source: URL;
    try {
      source = new URL(sender.url);
    } catch {
      return undefined;
    }
    if (
      source.origin !== "https://github.com" ||
      source.username ||
      source.password
    )
      return undefined;
    return pageRepository(sender.tab.url);
  }

  return {
    page: senderRepository,
    settings: (sender: chrome.runtime.MessageSender) =>
      sender.id === identity.id &&
      isPageUrl(sender.url, identity.settingsUrl) &&
      typeof sender.documentId === "string" &&
      sender.frameId === 0,
    popup: (sender: chrome.runtime.MessageSender | undefined) =>
      sender?.id === identity.id &&
      sender.url === identity.popupUrl &&
      (sender.tab === undefined || sender.frameId === 0),
  };
}
