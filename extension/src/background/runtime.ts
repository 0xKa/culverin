import {
  handleArchiveCounting,
  handleGithub,
  initializeGitHub,
} from "./github";
import { handleArchiveReply } from "../archive/bridge";
import { followToolbarIcon, handleColorSchemeReport } from "./toolbar-icon";
type Handler = (
  message: unknown,
  sender: chrome.runtime.MessageSender,
  respond: (value: unknown) => void,
) => boolean;
let started = false;
export function startBackground(additionalHandler?: Handler): void {
  if (started) return;
  started = true;
  initializeGitHub();
  followToolbarIcon();
  self.addEventListener("message", (event) => {
    handleArchiveReply(event as MessageEvent);
  });
  chrome.runtime.onMessage.addListener((message: unknown, sender, respond) => {
    if (handleColorSchemeReport(message, sender)) return false;
    if (handleArchiveCounting(message, sender)) return false;
    if (handleGithub(message, sender, respond)) return true;
    return additionalHandler?.(message, sender, respond) ?? false;
  });
}
